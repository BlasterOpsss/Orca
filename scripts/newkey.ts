import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const d = Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url");
const x = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
const bytes = new Uint8Array([...d, ...x]);
writeFileSync("devnet-keypair.json", JSON.stringify([...bytes]));
console.log((await createKeyPairSignerFromBytes(bytes)).address);
