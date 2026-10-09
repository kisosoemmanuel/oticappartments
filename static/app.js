const app = document.getElementById("app");

if (app) {
  app.innerHTML = "<p>Redirecting to the admin login...</p>";
}

if (window.location.pathname === "/") {
  window.location.replace("/secure-admin/login");
}
