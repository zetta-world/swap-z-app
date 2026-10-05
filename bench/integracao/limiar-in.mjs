import { createHmac, randomUUID } from "node:crypto";
const S = process.env.S, U = "http://ce-rest-20261005:3000";
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const c = `${b({alg:"HS256",typ:"JWT"})}.${b({role:"service_role",exp:4e9})}`;
const jwt = `${c}.${createHmac("sha256", S).update(c).digest("base64url")}`;
for (const n of [100, 150, 200, 250, 300, 350, 400, 450, 500, 1000]) {
  const ids = Array.from({ length: n }, () => randomUUID());
  const url = `${U}/bancada_estrategia?select=id&id=in.(${ids.join(",")})`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  const corpo = r.ok ? "" : (await r.text()).slice(0, 90);
  console.log(`n=${n} url=${url.length}B status=${r.status} ${corpo}`);
}
