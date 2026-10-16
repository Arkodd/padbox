// Anonymous usage counts on arkodd.goatcounter.com (the script tag in index.html counts the page views): a few events
// such as "connect/HOJA2" or "update/done/GS Platform/PhobGCC". No cookies, nothing about the person or the controller's
// settings. GoatCounter doesn't count on localhost. An event sent before its script has loaded waits for it (a PadBox
// already allowed in this browser connects as soon as the page opens).
export function count(name) {
  let tries = 0;
  const send = () => {
    try {
      const g = window.goatcounter;
      if (g && g.count) return g.count({ path: name, title: name, event: true });
    } catch (e) { return; }
    if (++tries < 20) setTimeout(send, 500);
  };
  send();
}
