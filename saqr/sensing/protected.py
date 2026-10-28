"""Protected registry: official domains (the whitelist), brand tokens and the lure vocabulary."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from ..config import DATA_DIR


@dataclass
class Entity:
    id: str
    name: str
    name_ar: str
    sector: str
    domains: list[str]
    brands: list[str]
    ambiguous: list[str] = field(default_factory=list)
    services: list[str] = field(default_factory=list)

    @property
    def labels(self) -> list[str]:
        """Registrable labels of the official domains, e.g. 'rta' for rta.ae, 'tax' for tax.gov.ae."""
        out = []
        for d in self.domains:
            parts = d.split(".")
            # strip official suffixes (gov.ae etc.) and the TLD
            if len(parts) >= 3 and parts[-2] in {"gov", "mil", "ac", "sch", "co", "com", "net", "org"}:
                out.append(parts[-3])
            else:
                out.append(parts[0] if len(parts) == 1 else parts[-2])
        return out


@dataclass
class Registry:
    entities: list[Entity]
    official_suffixes: list[str]
    government_cues: set[str]
    strong_keywords: set[str]
    normal_keywords: set[str]
    risky_tlds: set[str]
    free_cas: list[str]

    # ---------------------------------------------------------------------------------------------
    @property
    def protected_domains(self) -> list[str]:
        return [d for e in self.entities for d in e.domains]

    def entity_for_domain(self, domain: str) -> Entity | None:
        for e in self.entities:
            if domain in e.domains:
                return e
        return None

    def entity_for_brand(self, token: str) -> Entity | None:
        for e in self.entities:
            if token in e.brands or token in e.labels:
                return e
        return None

    def is_ambiguous(self, token: str) -> bool:
        for e in self.entities:
            if token in e.ambiguous:
                return True
        return len(token) <= 3

    @property
    def brand_tokens(self) -> set[str]:
        toks: set[str] = set()
        for e in self.entities:
            toks.update(b.replace("-", "") for b in e.brands)
            toks.update(e.brands)
            toks.update(e.labels)
        toks.discard("u")  # u.ae label is too short to be a token
        return toks

    @property
    def distinctive_brands(self) -> set[str]:
        """Brands worth typo / edit-distance matching: long enough, not ambiguous, and not merely a government cue
        glued to another cue ('abudhabigov', 'uaegov') — those would pull in every 'abudhabi…' business name."""
        return {t for t in self.brand_tokens if not self.is_ambiguous(t) and len(t) >= 4 and not self._cue_composed(t)}

    def _cue_composed(self, token: str) -> bool:
        cues = sorted(self.government_cues, key=len, reverse=True)
        rest = token
        while rest:
            for c in cues:
                if len(c) >= 2 and rest.startswith(c):
                    rest = rest[len(c):]
                    break
            else:
                return False
        return True

    @property
    def vocabulary(self) -> set[str]:
        """Everything the segmenter may split a label into."""
        return self.brand_tokens | self.government_cues | self.strong_keywords | self.normal_keywords

    def is_allowlisted(self, ascii_domain: str) -> Entity | None | bool:
        """True (or the Entity) if the *ASCII* name is an official property or a subdomain of one."""
        d = ascii_domain.lower().rstrip(".")
        if d.startswith("*."):
            d = d[2:]
        for suffix in self.official_suffixes:
            if d == suffix or d.endswith("." + suffix):
                return self.entity_for_domain(_registrable_under(d, suffix)) or True
        for e in self.entities:
            for od in e.domains:
                if d == od or d.endswith("." + od):
                    return e
        return False

    def is_free_ca(self, issuer: str) -> bool:
        issuer_l = issuer.lower()
        return any(ca.lower().split(" (")[0] in issuer_l for ca in self.free_cas)


def _registrable_under(domain: str, suffix: str) -> str:
    rest = domain[: -len(suffix) - 1] if domain != suffix else ""
    if not rest:
        return domain
    return rest.split(".")[-1] + "." + suffix


def load_registry(path: Path | None = None) -> Registry:
    raw = yaml.safe_load((path or DATA_DIR / "protected_domains.yaml").read_text(encoding="utf-8"))
    entities = [
        Entity(
            id=e["id"], name=e["name"], name_ar=e.get("name_ar", ""), sector=e.get("sector", ""),
            domains=[d.lower() for d in e["domains"]], brands=[b.lower() for b in e.get("brands", [])],
            ambiguous=[a.lower() for a in e.get("ambiguous", [])], services=e.get("services", []),
        )
        for e in raw["entities"]
    ]
    kw = raw.get("financial_keywords", {})
    return Registry(
        entities=entities,
        official_suffixes=[s.lower() for s in raw.get("official_suffixes", [])],
        government_cues=set(raw.get("government_cues", [])),
        strong_keywords=set(kw.get("strong", [])),
        normal_keywords=set(kw.get("normal", [])),
        risky_tlds=set(raw.get("risky_tlds", [])),
        free_cas=list(raw.get("free_cas", [])),
    )


@lru_cache
def get_registry() -> Registry:
    return load_registry()


@lru_cache
def get_lexicon() -> dict:
    return json.loads((DATA_DIR / "lexicon.json").read_text(encoding="utf-8"))
