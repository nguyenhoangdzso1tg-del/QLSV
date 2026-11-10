/* Áp dụng giao diện sáng/tối trước khi trang tải để tránh nháy màu */
(function () {
  try {
    var theme = localStorage.getItem("theme");
    if (theme !== "dark" && theme !== "light") theme = "light";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
