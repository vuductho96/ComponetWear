// Called by the masked PowerShell setup prompt. Password arrives on stdin, never argv or a file.
import { passwordHash, passwordValid, token } from "./auth-crypto.mjs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const password = JSON.parse(input).password;
if (!passwordValid(password))
  throw Error("Mật khẩu cần ít nhất 10 ký tự, tối đa 256 byte.");
console.log(
  JSON.stringify({ hash: await passwordHash(password), verifyToken: token() }),
);
