#!/usr/bin/env python3
"""Generate images using Gemini 3 Pro Image Preview via fal.ai or OpenRouter."""

import argparse
import base64
import json
import os
import sys
import urllib.request
import urllib.error


def find_env_file():
    """Search for .env file: skill root first, then cwd upward."""
    # 1. Check skill root directory (parent of scripts/)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    skill_root = os.path.dirname(script_dir)
    skill_env = os.path.join(skill_root, ".env")
    if os.path.isfile(skill_env):
        return skill_env

    # 2. Fallback: search from cwd upward
    path = os.getcwd()
    while True:
        env_path = os.path.join(path, ".env")
        if os.path.isfile(env_path):
            return env_path
        parent = os.path.dirname(path)
        if parent == path:
            return None
        path = parent


def load_env_keys() -> dict[str, str]:
    """Load API keys from .env file. Returns dict of found keys."""
    keys = {}

    # Check environment variables first
    for var in ("FAL_KEY", "OPENROUTER_API_KEY"):
        if os.environ.get(var):
            keys[var] = os.environ[var]

    env_path = find_env_file()
    if not env_path:
        return keys

    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key in ("FAL_KEY", "OPENROUTER_API_KEY") and value:
                    keys[key] = value

    return keys


def detect_backend(keys: dict[str, str]) -> str:
    """Auto-detect backend based on available keys. Prefer OpenRouter."""
    if "OPENROUTER_API_KEY" in keys:
        return "openrouter"
    if "FAL_KEY" in keys:
        return "fal"
    return "none"


# ---------------------------------------------------------------------------
# OpenRouter backend (stdlib only, no extra deps)
# ---------------------------------------------------------------------------

def generate_via_openrouter(
    api_key: str,
    prompt: str,
    num_images: int = 1,
    aspect_ratio: str = "1:1",
    resolution: str = "1K",
    output_format: str = "png",
    output_dir: str = ".",
    filename_prefix: str = "illustration",
    **_kwargs,
) -> dict:
    """Generate images via OpenRouter Chat Completions API."""

    image_instruction = ""
    if num_images > 1:
        image_instruction = f" Generate {num_images} different variations."

    messages = [
        {
            "role": "user",
            "content": f"{prompt}{image_instruction}",
        }
    ]

    # image_config: aspect_ratio + image_size (1K/2K/4K)
    image_config = {}
    if aspect_ratio and aspect_ratio != "auto":
        image_config["aspect_ratio"] = aspect_ratio
    if resolution:
        image_config["image_size"] = resolution

    body = {
        "model": "google/gemini-3-pro-image-preview",
        "messages": messages,
        "modalities": ["image", "text"],
    }
    if image_config:
        body["image_config"] = image_config

    payload = json.dumps(body).encode()

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    print("[openrouter] Sending request...", file=sys.stderr)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        print(f"ERROR: OpenRouter API returned {e.code}: {body}", file=sys.stderr)
        sys.exit(1)

    # Extract images from response
    os.makedirs(output_dir, exist_ok=True)
    saved_files = []
    urls = []

    message = result.get("choices", [{}])[0].get("message", {})

    # OpenRouter returns images in parts (multimodal content) or in message.images
    images_data = []

    # Format 1: message.images[]
    if message.get("images"):
        for img in message["images"]:
            url = img.get("image_url", {}).get("url", "")
            if url:
                images_data.append(url)

    # Format 2: message.content as array with image parts
    elif isinstance(message.get("content"), list):
        for part in message["content"]:
            if part.get("type") == "image_url":
                url = part.get("image_url", {}).get("url", "")
                if url:
                    images_data.append(url)

    for i, image_url in enumerate(images_data):
        suffix = f"_{i+1}" if len(images_data) > 1 else ""
        filename = f"{filename_prefix}{suffix}.{output_format}"
        filepath = os.path.join(output_dir, filename)

        if image_url.startswith("data:"):
            # base64 data URL: data:image/png;base64,xxxxx
            header, _, b64data = image_url.partition(",")
            img_bytes = base64.b64decode(b64data)
            with open(filepath, "wb") as f:
                f.write(img_bytes)
        else:
            # Remote URL
            urllib.request.urlretrieve(image_url, filepath)
            urls.append(image_url)

        saved_files.append(filepath)
        print(f"[openrouter] Saved: {filepath}", file=sys.stderr)

    # Extract text description if present
    description = ""
    if isinstance(message.get("content"), str):
        description = message["content"]
    elif isinstance(message.get("content"), list):
        text_parts = [p.get("text", "") for p in message["content"] if p.get("type") == "text"]
        description = "\n".join(text_parts)

    return {
        "backend": "openrouter",
        "files": saved_files,
        "urls": urls,
        "description": description,
    }


# ---------------------------------------------------------------------------
# fal.ai backend (requires fal-client)
# ---------------------------------------------------------------------------

def generate_via_fal(
    api_key: str,
    prompt: str,
    num_images: int = 1,
    aspect_ratio: str = "1:1",
    output_format: str = "png",
    safety_tolerance: str = "4",
    resolution: str = "1K",
    seed: int | None = None,
    output_dir: str = ".",
    filename_prefix: str = "illustration",
) -> dict:
    """Generate images via fal.ai API."""
    try:
        import fal_client
    except ImportError:
        print("ERROR: fal-client not installed. Run: cd <skill_dir> && uv venv && uv pip install fal-client", file=sys.stderr)
        sys.exit(1)

    os.environ["FAL_KEY"] = api_key

    arguments = {
        "prompt": prompt,
        "num_images": num_images,
        "aspect_ratio": aspect_ratio,
        "output_format": output_format,
        "safety_tolerance": safety_tolerance,
        "resolution": resolution,
    }
    if seed is not None:
        arguments["seed"] = seed

    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"  [log] {log['message']}", file=sys.stderr)

    print("[fal] Sending request...", file=sys.stderr)
    result = fal_client.subscribe(
        "fal-ai/gemini-3-pro-image-preview",
        arguments=arguments,
        with_logs=True,
        on_queue_update=on_queue_update,
    )

    os.makedirs(output_dir, exist_ok=True)
    saved_files = []
    for i, img in enumerate(result.get("images", [])):
        url = img["url"]
        ext = output_format
        suffix = f"_{i+1}" if num_images > 1 else ""
        filename = f"{filename_prefix}{suffix}.{ext}"
        filepath = os.path.join(output_dir, filename)
        urllib.request.urlretrieve(url, filepath)
        saved_files.append(filepath)
        print(f"[fal] Saved: {filepath}", file=sys.stderr)

    return {
        "backend": "fal",
        "files": saved_files,
        "urls": [img["url"] for img in result.get("images", [])],
        "description": result.get("description", ""),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Generate images with Gemini 3 Pro (auto-routes between OpenRouter and fal.ai)"
    )
    parser.add_argument("prompt", help="Text prompt for image generation")
    parser.add_argument("--num-images", type=int, default=1, choices=[1, 2, 3, 4])
    parser.add_argument("--aspect-ratio", default="1:1",
                        choices=["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"])
    parser.add_argument("--output-format", default="png", choices=["jpeg", "png", "webp"])
    parser.add_argument("--resolution", default="1K", choices=["1K", "2K", "4K"])
    parser.add_argument("--safety-tolerance", default="4", choices=["1", "2", "3", "4", "5", "6"])
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--output-dir", default=".")
    parser.add_argument("--filename-prefix", default="illustration")
    parser.add_argument("--backend", default=None, choices=["fal", "openrouter"],
                        help="Force a specific backend (default: auto-detect from .env keys)")
    args = parser.parse_args()

    keys = load_env_keys()
    backend = args.backend or detect_backend(keys)

    if backend == "none":
        print("ERROR: No API key found in .env file.", file=sys.stderr)
        print("Please add one of the following to the .env file in the skill directory:", file=sys.stderr)
        print("  OPENROUTER_API_KEY=your_openrouter_key   (https://openrouter.ai/keys)", file=sys.stderr)
        print("  FAL_KEY=your_fal_key                     (https://fal.ai/dashboard/keys)", file=sys.stderr)
        sys.exit(1)

    print(f"[router] Using backend: {backend}", file=sys.stderr)

    if backend == "openrouter":
        result = generate_via_openrouter(
            api_key=keys["OPENROUTER_API_KEY"],
            prompt=args.prompt,
            num_images=args.num_images,
            aspect_ratio=args.aspect_ratio,
            resolution=args.resolution,
            output_format=args.output_format,
            output_dir=args.output_dir,
            filename_prefix=args.filename_prefix,
        )
    elif backend == "fal":
        result = generate_via_fal(
            api_key=keys["FAL_KEY"],
            prompt=args.prompt,
            num_images=args.num_images,
            aspect_ratio=args.aspect_ratio,
            output_format=args.output_format,
            resolution=args.resolution,
            safety_tolerance=args.safety_tolerance,
            seed=args.seed,
            output_dir=args.output_dir,
            filename_prefix=args.filename_prefix,
        )
    else:
        print(f"ERROR: Unknown backend '{backend}'", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
