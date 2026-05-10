(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const authMsg = document.getElementById("authMsg");
    const emailEl = document.getElementById("loginEmail");
    const passwordEl = document.getElementById("loginPassword");
    const submitBtn = document.getElementById("loginSubmitBtn");
    const togglePasswordBtn = document.getElementById("togglePasswordBtn");

    if (!loginForm || !authMsg || !emailEl || !passwordEl || !submitBtn) {
      console.error("Login page is missing required elements.");
      return;
    }

    function getNextPage() {
      const params = new URLSearchParams(window.location.search);
      return params.get("next") || "index.html";
    }

    function showMessage(message, type = "error") {
      authMsg.textContent = message;
      authMsg.className = `auth-msg ${type}`;
    }

    function clearMessage() {
      authMsg.textContent = "";
      authMsg.className = "auth-msg hidden";
    }

    function setLoading(isLoading) {
      emailEl.disabled = isLoading;
      passwordEl.disabled = isLoading;
      submitBtn.disabled = isLoading;
      if (togglePasswordBtn) togglePasswordBtn.disabled = isLoading;
      submitBtn.textContent = isLoading ? "Logging in..." : "Login";
    }

    if (togglePasswordBtn) {
      togglePasswordBtn.addEventListener("click", () => {
        const isHidden = passwordEl.type === "password";
        passwordEl.type = isHidden ? "text" : "password";
        togglePasswordBtn.textContent = isHidden ? "Hide" : "Show";
        togglePasswordBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
        passwordEl.focus();
      });
    }

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMessage();

      const email = emailEl.value.trim();
      const password = passwordEl.value;

      if (!email || !password) {
        showMessage("Please enter your email and password.", "error");
        return;
      }

      if (!window.sb || !window.sb.auth) {
        showMessage("Supabase connection is not loaded. Check supabaseClient.js.", "error");
        return;
      }

      try {
        setLoading(true);

        const { error } = await window.sb.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          showMessage(error.message, "error");
          return;
        }

        window.location.replace(getNextPage());
      } catch (err) {
        showMessage(err.message || "Login failed.", "error");
      } finally {
        setLoading(false);
      }
    });
  });
})();
