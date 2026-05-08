(function () {
  const auth = window.PortalAuth;
  if (!auth) return;

  function getCurrentSlug() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    const last = decodeURIComponent(parts[parts.length - 1]);
    if (last.toLowerCase() === "index.html") {
      return parts.length > 1 ? decodeURIComponent(parts[parts.length - 2]) : "";
    }
    return last.includes(".") ? "" : last;
  }

  function injectShell(user, isAdmin) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("style", [
      "position:fixed",
      "top:16px",
      "right:16px",
      "z-index:1400",
      "display:flex",
      "align-items:center",
      "gap:10px",
      "padding:10px 12px",
      "border:1px solid rgba(255,255,255,0.16)",
      "border-radius:16px",
      "background:rgba(8,8,8,0.82)",
      "backdrop-filter:blur(14px)",
      "box-shadow:0 20px 40px rgba(0,0,0,0.24)",
      "font-family:inherit"
    ].join(";"));

    const info = document.createElement("div");
    info.setAttribute("style", "display:flex;flex-direction:column;gap:2px;min-width:0;");
    info.innerHTML = `
      <strong style="font-size:0.78rem;color:#fff;letter-spacing:0.01em;white-space:nowrap;">${user.name || user.email}</strong>
      <span style="font-size:0.68rem;color:#cbd5e1;white-space:nowrap;">${isAdmin ? "ambiente admin" : user.email}</span>
    `;

    const adminButton = document.createElement("button");
    adminButton.type = "button";
    adminButton.textContent = "Admin";
    adminButton.setAttribute("style", [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "height:36px",
      "padding:0 14px",
      "border:none",
      "border-radius:999px",
      "background:#fff",
      "color:#111827",
      "font:inherit",
      "font-size:0.76rem",
      "font-weight:700",
      "cursor:pointer"
    ].join(";"));
    adminButton.addEventListener("click", () => {
      window.location.href = auth.toAppUrl("admin/index.html");
    });

    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.textContent = "Sair";
    logoutButton.setAttribute("style", [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "height:36px",
      "padding:0 14px",
      "border:1px solid rgba(255,255,255,0.12)",
      "border-radius:999px",
      "background:linear-gradient(135deg,#F29725 0%,#F29725 100%)",
      "color:#fff",
      "font:inherit",
      "font-size:0.76rem",
      "font-weight:700",
      "cursor:pointer"
    ].join(";"));
    logoutButton.addEventListener("click", () => {
      auth.logout();
    });

    wrapper.append(info);
    if (isAdmin) wrapper.append(adminButton);
    wrapper.append(logoutButton);
    document.body.append(wrapper);
  }

  (async function bootstrapGuard() {
    try {
      await auth.init();
    } catch (error) {
      window.location.replace(auth.toAppUrl("index.html"));
      return;
    }

    const sessionUser = auth.getSessionUser();
    const loginUrl = auth.toAppUrl("index.html");
    const currentSlug = getCurrentSlug();

    if (!sessionUser) {
      window.location.replace(loginUrl);
      return;
    }

    if (sessionUser.role !== "admin") {
      const isAuthorized = sessionUser.status === "approved" && sessionUser.clientSlug === currentSlug;
      if (!isAuthorized) {
        await auth.clearSession();
        window.location.replace(loginUrl);
        return;
      }
    }

    window.addEventListener("DOMContentLoaded", () => {
      injectShell(sessionUser, sessionUser.role === "admin");
    });
  })();
})();
