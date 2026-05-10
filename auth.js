// auth.js (stable)
(async () => {
  // prevent running twice (glitch fix)
  if (window.__AUTH_RUNNING__) return;
  window.__AUTH_RUNNING__ = true;

  // ensure supabase client exists
  if (!window.sb) {
    console.error("Supabase client (window.sb) not found. Check script order.");
    return;
  }

  const { data, error } = await window.sb.auth.getSession();
  const token = data?.session?.access_token;

  if (!token) {
    const page = window.location.pathname.split("/").pop();
    // if we're already on login page, do nothing
    if (page === "login.html") return;

    const next = encodeURIComponent(page);
    window.location.replace(`login.html?next=${next}`);
    return;
  }

  window.ACCESS_TOKEN = token;
})();