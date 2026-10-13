#!/usr/bin/env python3
"""Sign repository index bytes; keep the repository key separate from author credentials."""
import argparse
import base64
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


def main():
    parser = argparse.ArgumentParser(description="生成或验证 Muvyo 仓库索引签名")
    parser.add_argument("action", choices=("init-key", "sign", "verify"))
    parser.add_argument("--key", type=Path, help="仓库专用 Ed25519 PEM 私钥路径")
    parser.add_argument("--index", type=Path, default=Path("index.json"))
    args = parser.parse_args()
    if args.action == "init-key":
        if args.key is None:
            parser.error("需要 --key")
        if args.index.exists() and json.loads(args.index.read_bytes()).get("public_key"):
            parser.error("索引已有仓库公钥，请使用原私钥，不得重新生成")
        key = Ed25519PrivateKey.generate()
        # Exclusive creation: never overwrite an existing key, including a symlink.
        import os
        fd = os.open(args.key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(key.private_bytes(serialization.Encoding.PEM,
                                          serialization.PrivateFormat.PKCS8,
                                          serialization.NoEncryption()))
        print("仓库私钥已创建，请安全备份，不要提交")
        return
    data = args.index.read_bytes()
    index = json.loads(data)
    signature_path = args.index.with_name(args.index.name + ".sig")
    if args.action == "sign":
        if args.key is None:
            parser.error("需要 --key")
        key = serialization.load_pem_private_key(args.key.read_bytes(), password=None)
        if not isinstance(key, Ed25519PrivateKey):
            parser.error("仓库私钥必须是 Ed25519")
        public = base64.b64encode(key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode("ascii")
        if index.get("public_key") and index["public_key"] != public:
            parser.error("私钥与已登记的仓库公钥不匹配，停止签名")
        if not index.get("public_key"):
            index["public_key"] = public
            data = (json.dumps(index, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            args.index.write_bytes(data)
        signature_path.write_bytes(base64.b64encode(key.sign(data)) + b"\n")
    public_key = Ed25519PublicKey.from_public_bytes(
        base64.b64decode(index["public_key"], validate=True))
    public_key.verify(base64.b64decode(signature_path.read_bytes().strip(), validate=True),
                      args.index.read_bytes())
    print("仓库索引签名验证通过")


if __name__ == "__main__":
    main()
