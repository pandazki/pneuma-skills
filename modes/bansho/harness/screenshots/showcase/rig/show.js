(() => {
  document.querySelectorAll("[data-shot-hidden]").forEach((el) => delete el.dataset.shotHidden);
  return "shown";
})()
