"""Visual similarity: does the suspect page look like a real government page?

Encoders produce an L2-normalised embedding of the above-the-fold screenshot; the gallery of reference
pages is searched by cosine similarity, and the best matches are confirmed with SSIM.

  DinoEncoder        DINOv3 (facebook/dinov3-*) with DINOv2 fallback, via `pip install saqr[ml]`. Self-supervised
                     ViT features are strong at near-duplicate / layout similarity without task-specific training.
  PerceptualEncoder  dependency-free fallback used when torch is unavailable: layout grid, DCT (pHash-style),
                     colour histogram, edge grid and row/column colour profiles. Clones of a page score > 0.9;
                     unrelated pages ~0.5-0.75.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image
from scipy.fft import dctn
from scipy.ndimage import gaussian_filter, sobel

log = logging.getLogger(__name__)

FOLD_W, FOLD_H = 1280, 800


def load_image(path: str | Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def above_the_fold(img: Image.Image, width: int = FOLD_W, height: int = FOLD_H) -> Image.Image:
    """Top viewport region; pad with the page's edge colour if the page is shorter/narrower."""
    if img.width != width:
        img = img.resize((width, max(1, round(img.height * width / img.width))), Image.LANCZOS)
    if img.height >= height:
        return img.crop((0, 0, width, height))
    canvas = Image.new("RGB", (width, height), img.getpixel((img.width // 2, img.height - 1)))
    canvas.paste(img, (0, 0))
    return canvas


def _l2(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


class VisualEncoder(Protocol):
    name: str
    dims: int

    def embed(self, img: Image.Image) -> np.ndarray: ...


class PerceptualEncoder:
    name = "perceptual"

    def __init__(self) -> None:
        self.dims = 32 * 32 + 63 + 192 + 256 + 192 + 24 * 16 * 3 + 64 * 10 * 3

    def embed(self, img: Image.Image) -> np.ndarray:
        fold = above_the_fold(img)
        rgb = np.asarray(fold.resize((256, 160), Image.BILINEAR), dtype=np.float32) / 255.0
        gray = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)

        # 0. colour layout (24x16 RGB) and header band (top 200px): where the brand colours sit
        c24 = np.asarray(fold.resize((24, 16), Image.BOX), dtype=np.float32) / 255.0
        clayout = _l2((c24 - c24.mean(axis=(0, 1))).ravel())
        hdr = np.asarray(fold.crop((0, 0, FOLD_W, 200)).resize((64, 10), Image.BOX), dtype=np.float32) / 255.0
        header = _l2((hdr - hdr.mean(axis=(0, 1))).ravel())

        # 1. layout grid: 32x32 block means, zero-mean (captures where light/dark regions are)
        g32 = np.asarray(fold.convert("L").resize((32, 32), Image.BOX), dtype=np.float32) / 255.0
        layout = _l2((g32 - g32.mean()).ravel())

        # 2. low-frequency DCT of 64x64 grayscale (pHash-like structure signature)
        g64 = np.asarray(fold.convert("L").resize((64, 64), Image.BOX), dtype=np.float32)
        d = dctn(g64, norm="ortho")[:8, :8].ravel()[1:]
        dct = _l2(d)

        # 3. HSV colour histogram 12x4x4
        hsv = np.asarray(fold.convert("HSV").resize((256, 160), Image.BILINEAR), dtype=np.float32)
        hist, _ = np.histogramdd(hsv.reshape(-1, 3), bins=(12, 4, 4), range=((0, 256), (0, 256), (0, 256)))
        colour = _l2(np.sqrt(hist.ravel()))  # sqrt dampens dominant backgrounds

        # 4. edge density grid 16x16 (where the structure is)
        mag = np.hypot(sobel(gray, axis=0), sobel(gray, axis=1))
        eg = mag.reshape(16, 10, 16, 16).mean(axis=(1, 3))
        edges = _l2(eg.ravel())

        # 5. row / column colour profiles (header bars, side panels)
        rows = rgb.reshape(32, 5, 256, 3).mean(axis=(1, 2))      # 32 x 3
        cols = rgb.reshape(160, 32, 8, 3).mean(axis=(0, 2))      # 32 x 3
        profile = _l2(np.concatenate([(rows - rows.mean(0)).ravel(), (cols - cols.mean(0)).ravel()]))

        # Weights chosen on the fixture set: clones of a page score ~0.93, other government portals ~0.9,
        # unrelated pages < 0.3 (see docs/architecture.md, "visual encoder calibration").
        weights = {"layout": 0.6, "dct": 0.5, "colour": 1.2, "edges": 0.5, "profile": 1.2, "clayout": 1.5, "header": 1.2}
        vec = np.concatenate([layout * weights["layout"], dct * weights["dct"], colour * weights["colour"],
                              edges * weights["edges"], profile * weights["profile"], clayout * weights["clayout"],
                              header * weights["header"]]).astype(np.float32)
        return _l2(vec)


class DinoEncoder:
    """DINOv3 / DINOv2 image embeddings (CLS + mean patch token)."""

    name = "dino"

    def __init__(self, model_id: str, fallback_model_id: str | None = None, device: str | None = None) -> None:
        import torch  # noqa: F401  (import error -> caller falls back)
        from transformers import AutoImageProcessor, AutoModel

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        last_exc: Exception | None = None
        for mid in [model_id] + ([fallback_model_id] if fallback_model_id else []):
            try:
                self.processor = AutoImageProcessor.from_pretrained(mid)
                self.model = AutoModel.from_pretrained(mid).to(self.device).eval()
                self.model_id = mid
                break
            except Exception as exc:  # gated model without token, offline, etc.
                last_exc = exc
                log.warning("could not load %s: %s", mid, exc)
        else:
            raise RuntimeError(f"no DINO model could be loaded: {last_exc}")
        self.name = f"dino:{self.model_id.split('/')[-1]}"
        with torch.no_grad():
            probe = self._forward(Image.new("RGB", (224, 224)))
        self.dims = int(probe.shape[-1])

    def _forward(self, img: Image.Image) -> np.ndarray:
        inputs = self.processor(images=img, return_tensors="pt").to(self.device)
        out = self.model(**inputs).last_hidden_state[0]
        cls, patches = out[0], out[1:]
        vec = self.torch.cat([cls, patches.mean(0)]).float().cpu().numpy()
        return vec

    def embed(self, img: Image.Image) -> np.ndarray:
        with self.torch.no_grad():
            return _l2(self._forward(above_the_fold(img)))


def build_encoder(kind: str, model_id: str = "", fallback_model_id: str = "") -> VisualEncoder:
    if kind == "dino":
        try:
            enc = DinoEncoder(model_id, fallback_model_id or None)
            log.info("visual encoder: %s (%d dims)", enc.name, enc.dims)
            return enc
        except Exception as exc:
            log.warning("DINO encoder unavailable (%s); using perceptual encoder", exc)
    return PerceptualEncoder()


# ---------------------------------------------------------------------------------------------------- SSIM
def to_gray_small(img: Image.Image, size: tuple[int, int] = (256, 160)) -> np.ndarray:
    return np.asarray(above_the_fold(img).convert("L").resize(size, Image.BILINEAR), dtype=np.float64)


def ssim(a: np.ndarray, b: np.ndarray, sigma: float = 1.5) -> float:
    """Mean structural similarity (Wang et al. 2004) on grayscale arrays of equal shape, range 0..255."""
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mu_a, mu_b = gaussian_filter(a, sigma), gaussian_filter(b, sigma)
    saa = gaussian_filter(a * a, sigma) - mu_a**2
    sbb = gaussian_filter(b * b, sigma) - mu_b**2
    sab = gaussian_filter(a * b, sigma) - mu_a * mu_b
    num = (2 * mu_a * mu_b + c1) * (2 * sab + c2)
    den = (mu_a**2 + mu_b**2 + c1) * (saa + sbb + c2)
    return float(np.clip((num / den).mean(), -1, 1))


# ---------------------------------------------------------------------------------------------- gallery index
@dataclass
class Reference:
    id: str
    name: str
    domain: str
    entity: str
    screenshot: Path
    logo: Path | None = None
    meta: dict = field(default_factory=dict)
    embedding: np.ndarray | None = None
    gray: np.ndarray | None = None


class GalleryIndex:
    def __init__(self, encoder: VisualEncoder) -> None:
        self.encoder = encoder
        self.refs: list[Reference] = []
        self._matrix: np.ndarray | None = None

    def add(self, ref: Reference) -> None:
        img = load_image(ref.screenshot)
        ref.embedding = self.encoder.embed(img)
        ref.gray = to_gray_small(img)
        self.refs.append(ref)
        self._matrix = None

    def _mat(self) -> np.ndarray:
        if self._matrix is None:
            self._matrix = np.stack([r.embedding for r in self.refs]) if self.refs else np.zeros((0, 1))
        return self._matrix

    def search(self, img: Image.Image, k: int = 3) -> list[tuple[Reference, float, float]]:
        """Top-k (reference, cosine similarity, ssim) for a suspect screenshot."""
        if not self.refs:
            return []
        q = self.encoder.embed(img)
        sims = self._mat() @ q
        order = np.argsort(-sims)[:k]
        gray = to_gray_small(img)
        out = []
        for i in order:
            ref = self.refs[int(i)]
            s = ssim(gray, ref.gray) if ref.gray is not None else None
            out.append((ref, float(sims[int(i)]), float(s) if s is not None else None))
        return out

    def __len__(self) -> int:
        return len(self.refs)
