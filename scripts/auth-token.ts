import "dotenv/config";
import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET;
const issuer = process.env.JWT_ISSUER;
const audience = process.env.JWT_AUDIENCE;
if (!secret || !issuer || !audience) {
  throw new Error("JWT_SECRET, JWT_ISSUER and JWT_AUDIENCE are required");
}
const token = jwt.sign({ scope: ["capacity:read", "capacity:write"] }, secret, {
  subject: "local-client",
  issuer,
  audience,
  expiresIn: "1h",
  algorithm: "HS256",
});
process.stdout.write(`${token}\n`);
