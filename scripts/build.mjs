import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destinationDir = resolve(root, "public/vendor");

await mkdir(destinationDir, { recursive: true });
for (const filename of ["three.module.min.js", "three.core.min.js"]) {
  await copyFile(
    resolve(root, "node_modules/three/build", filename),
    resolve(destinationDir, filename),
  );
}
console.log("Prepared self-hosted Three.js runtime.");
