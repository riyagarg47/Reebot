import jwt from "jsonwebtoken";

/** Create the short-lived credential sent by the client on authenticated calls. */
export function signToken(userId) {
  // `sub` is the standard JWT field for the identity represented by the token.
  return jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function publicUser(user) {
  // Never expose password hashes or other internal model fields to the client.
  return { id: user._id, name: user.name, email: user.email };
}

/** Express middleware that validates a Bearer token and exposes its user ID. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Please log in." });
  }

  try {
    // verify() checks both the signature and expiry before the request proceeds.
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Please log in again." });
  }
}
