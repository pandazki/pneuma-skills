(() => {
  const style = document.getElementById("shot-style") || document.createElement("style");
  style.id = "shot-style";
  style.textContent = "[data-shot-hidden]{display:none !important}";
  document.head.appendChild(style);
  const map = document.querySelector(".bansho-map");
  const mapBox = map && map.closest("div.absolute");
  if (mapBox) mapBox.dataset.shotHidden = "1";
  const toggle = document.querySelector('[aria-label="Board or lecture notes view"]');
  const cluster = toggle && toggle.closest("div.absolute");
  if (cluster) cluster.dataset.shotHidden = "1";
  const par = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Parallax");
  const parBox = par && par.closest("div.absolute");
  if (parBox && parBox !== cluster) parBox.dataset.shotHidden = "1";
  return JSON.stringify({ map: !!mapBox, cluster: !!cluster, par: !!parBox });
})()
