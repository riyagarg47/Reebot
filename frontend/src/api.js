const TOKEN_KEY = "reebot_token";
export const THEME_KEY = "reebot_theme";

let token = localStorage.getItem(TOKEN_KEY) || "";

export function getToken() {
  return token;
}

export function setToken(next) {
  token = next || "";
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function authedFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!options.form && options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(path, {
    ...options,
    headers,
    body: options.form
      ? options.form
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });
}

export async function api(path, options = {}) {
  const res = await authedFetch(path, options);

  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text();

  if (!res.ok) {
    const error = new Error(data?.error || "Something went wrong.");
    error.status = res.status;
    throw error;
  }
  return data;
}
