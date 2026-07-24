/**
 * Toast 通知 + 按钮状态工具
 */

export function showToast(message, type = "info", duration = 2800) {
  const container = document.querySelector("#toastContainer");
  if (!container) return;
  const icons = { success: "\u2713", error: "\u2717", warning: "!", info: "i" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || "i"}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("leaving");
    toast.addEventListener("animationend", () => toast.remove());
  }, duration);
}

export function showButtonSaved(button, text = "已保存") {
  if (!button) return;
  const original = button.textContent;
  button.textContent = text;
  button.classList.add("saved-flash");
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove("saved-flash");
  }, 1600);
  const isDanger = button.classList.contains("danger-btn");
  showToast(text, isDanger ? "warning" : "success");
}

export function setButtonLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button._origDisabled = button.disabled;
    button.disabled = true;
    button.classList.add("btn-loading");
  } else {
    button.classList.remove("btn-loading");
    button.disabled = !!button._origDisabled;
    delete button._origDisabled;
  }
}
