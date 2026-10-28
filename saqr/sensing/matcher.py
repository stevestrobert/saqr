"""Look-alike matcher: the cheap text filter that turns millions of new names a day into a short candidate list.

Signals (each adds weight, total capped at 100):
  allowlist          official domain / subdomain / official suffix  -> never a candidate (score 0, allowlisted)
  homoglyph          non-ASCII look-alike letters whose skeleton spells a protected name (IDN homograph)
  tld_swap           registrable label equals a protected label under another suffix (salik.com)
  embedded_domain    protected domain inside the name (rta.ae.secure-pay.com, www-rta-ae.com)
  brand_token        protected brand as a token (dubaipolice-fines.online); ambiguous short brands weigh less
  typo               dnstwist-style permutation of a distinctive brand (emiratspost, dubaipolcie)
  edit_distance      Damerau-Levenshtein <= 1-2 from a brand
  keyword            payment / fine / refund vocabulary (strong & normal)
  gov_cue            gov, uae, dubai, ministry, ae ... (weak alone, strong with a brand)
  risky_tld          cheap abuse-prone TLD (tiny)
The matcher is deterministic and explainable: every point comes with a reason string shown in the UI.
"""
from __future__ import annotations

from functools import lru_cache

from rapidfuzz.distance import DamerauLevenshtein

from ..models import MatchReason, MatchResult
from .normalize import ascii_glyph_variants, coarse_tokens, has_non_ascii, segment, skeleton, split_domain, to_unicode
from .protected import Registry, get_registry

KEYBOARD = {
    "q": "wa", "w": "qes", "e": "wrd", "r": "etf", "t": "ryg", "y": "tuh", "u": "yij", "i": "uok", "o": "ipl", "p": "o",
    "a": "qsz", "s": "awdz", "d": "sefx", "f": "drgc", "g": "fthv", "h": "gyjb", "j": "hukn", "k": "jilm", "l": "ko",
    "z": "asx", "x": "zsdc", "c": "xdfv", "v": "cfgb", "b": "vghn", "n": "bhjm", "m": "njk",
}
VOWELS = "aeiou"
W_BRAND, W_BRAND_AMBIG, W_COMBO, W_HOMOGLYPH, W_TLD_SWAP, W_EMBEDDED, W_TYPO, W_EDIT = 45, 25, 20, 50, 50, 45, 40, 40
W_KW_STRONG, W_KW_NORMAL, W_KW_CAP, W_CUE, W_CUE_CAP, W_RISKY_TLD = 20, 15, 35, 10, 20, 5


def typo_permutations(word: str) -> set[str]:
    """dnstwist-style permutations of one brand token."""
    out: set[str] = set()
    n = len(word)
    for i in range(n):
        out.add(word[:i] + word[i + 1 :])                       # omission
        out.add(word[:i] + word[i] + word[i:])                  # repetition
        if i < n - 1:
            out.add(word[:i] + word[i + 1] + word[i] + word[i + 2 :])  # transposition
        for k in KEYBOARD.get(word[i], ""):                     # replacement (adjacent key)
            out.add(word[:i] + k + word[i + 1 :])
            out.add(word[:i] + k + word[i:])                    # insertion
        if word[i] in VOWELS:
            for v in VOWELS:
                if v != word[i]:
                    out.add(word[:i] + v + word[i + 1 :])       # vowel swap
        for bit in range(8):                                    # bitsquatting
            c = chr(ord(word[i]) ^ (1 << bit))
            if c.isascii() and (c.isalnum() or c == "-") and c != word[i]:
                out.add(word[:i] + c.lower() + word[i + 1 :])
    for seq, repl in (("m", "rn"), ("w", "vv"), ("d", "cl")):
        if seq in word:
            out.add(word.replace(seq, repl, 1))
    out.discard(word)
    return {p for p in out if len(p) >= 3}


class LookalikeMatcher:
    def __init__(self, registry: Registry | None = None, threshold: int = 40) -> None:
        self.registry = registry or get_registry()
        self.threshold = threshold
        self.vocab = self.registry.vocabulary
        self.brands = self.registry.brand_tokens
        self.distinctive = self.registry.distinctive_brands
        self.labels = {lab for e in self.registry.entities for lab in e.labels if len(lab) >= 2}
        self.typo_index: dict[str, str] = {}
        for b in self.distinctive:
            if len(b) < 6:
                continue  # permutations of short brands collide with ordinary words ('post' from 'epost')
            for p in typo_permutations(b):
                if len(p) >= 5 and p not in self.vocab:
                    self.typo_index.setdefault(p, b)
        self.protected_domains = sorted(self.registry.protected_domains, key=len, reverse=True)

    # ------------------------------------------------------------------------------------------
    def match(self, raw_domain: str) -> MatchResult:
        reg = self.registry
        ascii_domain = raw_domain.lower().strip().rstrip(".")
        if ascii_domain.startswith("*."):
            ascii_domain = ascii_domain[2:]
        unicode_domain = to_unicode(ascii_domain)
        skel = skeleton(unicode_domain)
        result = MatchResult(domain=ascii_domain, unicode_domain=unicode_domain, skeleton=skel)

        # 1. Whitelist: official property -> never a candidate.
        allow = reg.is_allowlisted(ascii_domain)
        if allow:
            result.allowlisted = True
            if allow is not True:
                result.protected_entity, result.protected_domain = allow.name, allow.domains[0]
            return result

        reasons: list[MatchReason] = []
        parts = split_domain(skel)
        homoglyph = has_non_ascii(unicode_domain) and skel != unicode_domain

        # 2. Whole-name tricks ---------------------------------------------------------------------
        for pd in self.protected_domains:
            pd_skel = pd
            if parts.registrable == pd_skel and homoglyph:
                reasons.append(MatchReason(kind="homoglyph", weight=W_HOMOGLYPH + W_TLD_SWAP,
                                           detail=f"IDN homograph of {pd}: '{unicode_domain}' renders like the official domain"))
                self._attribute(result, pd)
                break
            flat = pd.replace(".", "")
            flat_ok = len(flat) >= 5  # 'uae' (u.ae) is a cue, not an embedded domain
            # bounded on both sides: 'rta.ae.secure-login.com' yes, 'smarta.ae.pages.dev' no
            if (f".{pd}." in f".{skel}." and skel != pd) or \
               f"-{pd.replace('.', '-')}-" in f"-{parts.label}-" or (flat_ok and (f"www-{flat}" in skel or parts.label == flat or
               parts.label.startswith(flat + "-") or parts.label.endswith("-" + flat))):
                reasons.append(MatchReason(kind="embedded_domain", weight=W_EMBEDDED,
                                           detail=f"official domain {pd} embedded in the name"))
                self._attribute(result, pd)
                break

        # 3. Tokens ------------------------------------------------------------------------------
        tokens: list[str] = []
        # Tokenise the letters-only skeleton (digits kept: 'cedar82' must not become 'cedarb2' -> 'darb').
        parts_l = split_domain(skeleton(unicode_domain, map_digits=False))
        for chunk in coarse_tokens(parts_l.subdomain + "." + parts_l.label if parts_l.subdomain else parts_l.label):
            if chunk in self.vocab:
                tokens.append(chunk)
                continue
            found = False
            for variant in ascii_glyph_variants(chunk):
                if variant in self.vocab:
                    tokens.append(variant)
                    found = True
                    break
            if found:
                continue
            seg = segment(chunk, self.vocab)
            if seg:
                tokens.extend(seg)
            else:
                tokens.append(chunk)
        # Digit substitutions ('rt4', 'sal1k', 'm0i'): only whole chunks that spell a brand after mapping count.
        for chunk in coarse_tokens(parts.subdomain + "." + parts.label if parts.subdomain else parts.label):
            if chunk in self.brands and chunk not in tokens and len(chunk) >= 3:
                tokens.append(chunk)

        # Hyphenated / split brands: 'dubai-police', 'e-dirham', 'uae-pass', 'emirates-post'
        joined: list[str] = []
        consumed: set[str] = set()
        for a, b in zip(tokens, tokens[1:]):
            if a + b in self.brands and a + b not in tokens:
                joined.append(a + b)
                consumed.update({a, b})
        tokens = joined + tokens
        result.tokens = tokens

        brand_hits: list[str] = []
        for t in tokens:
            if t in consumed and t not in self.brands:
                continue  # 'police' in 'dubai-police' is part of the joined brand, not a typo of 'adpolice'
            if t in self.brands and len(t) >= 3 and t not in reg.government_cues:
                ent = reg.entity_for_brand(t)
                ambiguous = reg.is_ambiguous(t)
                reasons.append(MatchReason(kind="brand_token", weight=W_BRAND_AMBIG if ambiguous else W_BRAND,
                                           detail=f"brand token '{t}'" + (f" ({ent.name})" if ent else "") +
                                                  (" — short/ambiguous" if ambiguous else "")))
                brand_hits.append(t)
                if ent and not result.protected_entity:
                    result.protected_entity, result.protected_domain = ent.name, ent.domains[0]
            elif t in self.typo_index and t not in self.vocab:
                b = self.typo_index[t]
                reasons.append(MatchReason(kind="typo", weight=W_TYPO, detail=f"'{t}' is a typo-squat of '{b}'"))
                brand_hits.append(b)
                self._attribute_brand(result, b)
            elif len(t) >= 5 and t not in self.vocab:
                near = self._near_brand(t)
                if near:
                    reasons.append(MatchReason(kind="edit_distance", weight=W_EDIT,
                                               detail=f"'{t}' is within edit distance {near[1]} of brand '{near[0]}'"))
                    brand_hits.append(near[0])
                    self._attribute_brand(result, near[0])

        # TLD swap: registrable label *is* a protected label under another suffix (salik.com, dubaipolice.net)
        if parts.label in self.labels and not any(r.kind in {"embedded_domain", "homoglyph"} for r in reasons):
            ent = reg.entity_for_brand(parts.label)
            if ent:
                ambiguous = reg.is_ambiguous(parts.label)
                reasons.append(MatchReason(kind="tld_swap", weight=W_TLD_SWAP if not ambiguous else 5,
                                           detail=f"'{parts.registrable}' reuses the official label '{parts.label}' of {ent.domains[0]} under .{parts.suffix}"))
                self._attribute(result, ent.domains[0])
                brand_hits.append(parts.label)

        if homoglyph and brand_hits and not any(r.kind == "homoglyph" for r in reasons):
            reasons.append(MatchReason(kind="homoglyph", weight=W_HOMOGLYPH,
                                       detail=f"look-alike Unicode letters: '{unicode_domain}' is spelled with non-Latin characters"))

        kw_weight = 0
        for t in dict.fromkeys(tokens):
            if t in brand_hits:
                continue  # 'tax' is both the FTA label and a keyword: count it once
            if t in reg.strong_keywords:
                kw_weight += W_KW_STRONG
                reasons.append(MatchReason(kind="keyword", weight=W_KW_STRONG, detail=f"lure keyword '{t}'"))
            elif t in reg.normal_keywords:
                kw_weight += W_KW_NORMAL
                reasons.append(MatchReason(kind="keyword", weight=W_KW_NORMAL, detail=f"financial keyword '{t}'"))
        kw_weight = min(kw_weight, W_KW_CAP)

        cue_weight = 0
        for t in dict.fromkeys(tokens):
            if t in reg.government_cues:
                cue_weight += W_CUE
                reasons.append(MatchReason(kind="gov_cue", weight=W_CUE, detail=f"government cue '{t}'"))
        cue_weight = min(cue_weight, W_CUE_CAP)

        # Combination bonus: a brand next to payment vocabulary (or a government cue). A short, ambiguous brand
        # ('tax', 'rta', 'moi') needs real payment vocabulary — 'portal.delta-tax.co.uk' is not a lure.
        all_ambiguous = brand_hits and all(reg.is_ambiguous(b) for b in brand_hits)
        if brand_hits and (kw_weight or (cue_weight and not all_ambiguous)):
            reasons.append(MatchReason(kind="combo", weight=W_COMBO,
                                       detail="brand combined with payment vocabulary / government cue"))

        tld = parts.suffix.split(".")[-1] if parts.suffix else ""
        if tld in reg.risky_tlds and reasons:
            reasons.append(MatchReason(kind="risky_tld", weight=W_RISKY_TLD, detail=f"abuse-prone TLD .{tld}"))

        # 4. Score ------------------------------------------------------------------------------
        score = 0
        for r in reasons:
            if r.kind == "keyword" or r.kind == "gov_cue":
                continue
            score += r.weight
        score += kw_weight + cue_weight
        result.score = max(0, min(100, score))
        result.reasons = sorted(reasons, key=lambda r: -r.weight)
        result.is_candidate = result.score >= self.threshold
        return result

    def best_match(self, domains: list[str]) -> MatchResult | None:
        """Match every SAN in a certificate and return the strongest result (allow-listed names excluded)."""
        best: MatchResult | None = None
        for d in domains:
            m = self.match(d)
            if m.allowlisted:
                if best is None:
                    best = m
                continue
            if best is None or best.allowlisted or m.score > best.score or \
               (m.score == best.score and len(m.domain) < len(best.domain)):  # prefer 'x.com' over 'www.x.com'
                best = m
        return best

    # ------------------------------------------------------------------------------------------
    @lru_cache(maxsize=65536)
    def _near_brand(self, token: str) -> tuple[str, int] | None:
        best: tuple[str, int] | None = None
        for b in self.distinctive:
            if abs(len(b) - len(token)) > 2:
                continue
            cutoff = 2 if len(b) >= 8 else 1
            d = DamerauLevenshtein.distance(token, b, score_cutoff=cutoff)
            if d <= cutoff and (best is None or d < best[1]):
                best = (b, d)
        return best

    def _attribute(self, result: MatchResult, protected_domain: str) -> None:
        if result.protected_domain:
            return
        ent = self.registry.entity_for_domain(protected_domain)
        result.protected_domain = protected_domain
        result.protected_entity = ent.name if ent else None

    def _attribute_brand(self, result: MatchResult, brand: str) -> None:
        if result.protected_domain:
            return
        ent = self.registry.entity_for_brand(brand)
        if ent:
            result.protected_entity, result.protected_domain = ent.name, ent.domains[0]


@lru_cache
def get_matcher(threshold: int = 40) -> LookalikeMatcher:
    return LookalikeMatcher(threshold=threshold)
