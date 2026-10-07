const parts = window.location.pathname.split("/").filter(Boolean);

if (parts.length === 3 && parts[0] === "3Dprojects" && parts[2] === "geo") {
  void import("./fullscreen-controls");
}
