/* Bygger sidorna ("Spel idag", sedan kommande dagar i veckan), roterar mellan dem och visar klockan.
   Passerade dagar visas aldrig, och flera dagar delar sida när de får plats.
   Skrivet i ES5 så att det fungerar i äldre TV-webbläsare. */
(function () {
  var DEFAULTS = { idag: 20, ovriga: 10 };
  var MANADER = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  var DAGAR = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
  var OM_LADDNING_EFTER_MS = 60 * 60 * 1000; // Ladda om sidan en gång i timmen så att ny data hämtas
  var STANDARD_LANGD_MIN = 180;              // Speltillfälle utan sluttid räknas som slut efter 3 timmar
  var UPPDATERINGSKOLL_MS = 5 * 60 * 1000;

  // Mått i em, ska stämma med styles.css (.lista)
  var KORT = 10;
  var LUCKA = 2.4;
  var LUCKA_EFTER_RUBRIK = 1.4;
  var RUBRIK = 3.4;
  var RUBRIK_MARGINAL = 3;
  var INGA = 3;
  var INGA_MARGINAL = 1;
  var MIN_SKALA = 0.55;                      // Så mycket får texten minskas för en enskild dag med många speltillfällen

  var sidorEl = el('sidor');
  var prickarEl = el('prickar');
  var sidor = [];
  var sekunder = copy(DEFAULTS);
  var aktuell = -1;
  var startad = new Date().getTime();

  function toArray(list) { return Array.prototype.slice.call(list); }
  function copy(o) { return { idag: o.idag, ovriga: o.ovriga }; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDatum(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function el(id) { return document.getElementById(id); }
  function versal(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function kortDatum(d) { return d.getDate() + ' ' + MANADER[d.getMonth()]; }

  // settings.json: { "sekunder": { "idag": 10, "ovriga": 5 } }
  function laddaInstallningar(klar) {
    var x = new XMLHttpRequest();
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var s = copy(DEFAULTS);
      try {
        var data = JSON.parse(x.responseText).sekunder || {};
        if (Number(data.idag) >= 1) s.idag = Number(data.idag);
        var ovriga = data.ovriga !== undefined ? data.ovriga : data.manOns; // manOns: gammal inställning
        if (Number(ovriga) >= 1) s.ovriga = Number(ovriga);
      } catch (e) { /* saknas eller felaktig fil: använd standardvärden */ }
      sekunder = s;
      klar();
    };
    x.open('GET', 'settings.json?t=' + new Date().getTime(), true);
    try { x.send(); } catch (e) { sekunder = copy(DEFAULTS); klar(); }
  }

  // Dagarna i veckan som sidan genererades för: [{ iso, datum, kort: [element] }]
  function hamtaDagar() {
    return toArray(document.querySelectorAll('#data .dag')).map(function (sektion) {
      var iso = sektion.getAttribute('data-date');
      var d = iso.split('-');
      return {
        iso: iso,
        datum: new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2])),
        kort: toArray(sektion.querySelectorAll('.kort'))
      };
    });
  }

  // Höjd i em för en dag; med rubrik när dagen inte är först på sidan (första dagens rubrik är sidans topprad)
  function dagHojd(dag, medRubrik) {
    var n = dag.kort.length;
    var h = medRubrik ? RUBRIK_MARGINAL + RUBRIK : 0;
    if (n === 0) return h + INGA + (medRubrik ? INGA_MARGINAL : 0);
    return h + n * KORT + (n - 1) * LUCKA + (medRubrik ? LUCKA_EFTER_RUBRIK - LUCKA : 0);
  }

  // Hur många em som listan på en sida rymmer, mätt i webbläsaren
  function tillgangligHojd() {
    var rot = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    var sida = document.createElement('div');
    sida.className = 'sida';
    sida.style.display = 'block';
    sida.style.visibility = 'hidden';
    var lista = document.createElement('div');
    lista.className = 'lista';
    sida.appendChild(lista);
    sidorEl.appendChild(sida);
    var h = lista.clientHeight / rot;
    sidorEl.removeChild(sida);
    return h > 10 ? h : 56;
  }

  // Dagens sida först, sedan kommande dagar. Flera dagar delar sida så länge de får plats.
  function planera(nu) {
    var iso = isoDatum(nu);
    var dagar = hamtaDagar();
    var idagDag = null;
    var kommande = [];
    for (var i = 0; i < dagar.length; i++) {
      if (dagar[i].iso === iso) idagDag = dagar[i];
      else if (dagar[i].iso > iso) kommande.push(dagar[i]);
    }

    var plan = [{ idag: true, dagar: [idagDag || { iso: iso, datum: nu, kort: [] }], hojd: 0 }];
    var tillganglig = tillgangligHojd();
    var sida = null;

    for (var k = 0; k < kommande.length; k++) {
      var dag = kommande[k];
      if (sida && sida.hojd + dagHojd(dag, true) <= tillganglig) {
        sida.dagar.push(dag);
        sida.hojd += dagHojd(dag, true);
      } else {
        sida = { idag: false, dagar: [dag], hojd: dagHojd(dag, false) };
        plan.push(sida);
      }
    }
    for (var p = 0; p < plan.length; p++) {
      if (plan[p].idag) plan[p].hojd = dagHojd(plan[p].dagar[0], false);
      plan[p].skala = plan[p].hojd > tillganglig ? Math.max(MIN_SKALA, tillganglig / plan[p].hojd) : 1;
    }
    return plan;
  }

  function skapaInga(text, stor) {
    var d = document.createElement('div');
    d.className = 'inga' + (stor ? ' stor' : '');
    d.innerHTML = '<span></span>';
    d.firstChild.textContent = text;
    return d;
  }

  function skapaSida(spec) {
    var sida = document.createElement('div');
    sida.className = 'sida' + (spec.idag ? ' idag-sida' : '');

    var forsta = spec.dagar[0].datum;
    var topp = el('topp-mall').querySelector('header').cloneNode(true);
    var veckodag = DAGAR[forsta.getDay()];
    topp.querySelector('h1').textContent = spec.idag ? 'Spel idag' : versal(veckodag);
    topp.querySelector('.datum').textContent = spec.idag ? veckodag + ' ' + kortDatum(forsta) : kortDatum(forsta);
    if (!spec.idag && (forsta.getDay() === 0 || forsta.getDay() === 6)) topp.className += ' helg';
    sida.appendChild(topp);

    var lista = document.createElement('div');
    lista.className = 'lista';
    for (var i = 0; i < spec.dagar.length; i++) {
      var dag = spec.dagar[i];
      if (i > 0) {
        var rubrik = document.createElement('div');
        rubrik.className = 'dagrubrik' + (dag.datum.getDay() === 0 || dag.datum.getDay() === 6 ? ' helg' : '');
        rubrik.innerHTML = '<span class="namn"></span><span class="datum"></span>';
        rubrik.childNodes[0].textContent = versal(DAGAR[dag.datum.getDay()]);
        rubrik.childNodes[1].textContent = kortDatum(dag.datum);
        lista.appendChild(rubrik);
      }
      for (var k = 0; k < dag.kort.length; k++) lista.appendChild(dag.kort[k].cloneNode(true));
      if (dag.kort.length === 0) {
        lista.appendChild(skapaInga(spec.idag ? 'Inga speltillfällen idag' : 'Inga speltillfällen', i === 0));
      }
    }
    if (spec.skala < 1) lista.style.fontSize = spec.skala + 'rem';
    sida.appendChild(lista);
    return sida;
  }

  function bygg() {
    var plan = planera(new Date());
    sidorEl.innerHTML = '';
    prickarEl.innerHTML = '';
    sidor = [];
    for (var i = 0; i < plan.length; i++) {
      var sida = skapaSida(plan[i]);
      sidorEl.appendChild(sida);
      sidor.push(sida);
      prickarEl.appendChild(document.createElement('span'));
    }
    tonaNerPasserade();
    uppdateraKlocka();
  }

  function tonaNerPasserade() {
    var nu = new Date();
    var minuter = nu.getHours() * 60 + nu.getMinutes();
    var kort = toArray(document.querySelectorAll('.idag-sida .kort'));
    for (var i = 0; i < kort.length; i++) {
      var start = Number(kort[i].getAttribute('data-start'));
      var slut = Number(kort[i].getAttribute('data-end'));
      if (slut < 0 && start >= 0) slut = start + STANDARD_LANGD_MIN;
      var passerad = slut >= 0 && minuter >= slut;
      kort[i].className = kort[i].className.replace(/\s*\bpasserad\b/, '') + (passerad ? ' passerad' : '');
    }
  }

  function uppdateraKlocka() {
    var nu = new Date();
    var klockor = toArray(document.querySelectorAll('.klocka'));
    for (var i = 0; i < klockor.length; i++) klockor[i].textContent = pad(nu.getHours()) + ':' + pad(nu.getMinutes());
  }

  function visa(index) {
    aktuell = index;
    var prickar = prickarEl.childNodes;
    for (var i = 0; i < sidor.length; i++) {
      sidor[i].className = sidor[i].className.replace(/\s*\baktiv\b/, '') + (i === index ? ' aktiv' : '');
      prickar[i].className = i === index ? 'aktiv' : '';
    }
    setTimeout(nasta, (index === 0 ? sekunder.idag : sekunder.ovriga) * 1000);
  }

  function nasta() {
    var n = (aktuell + 1) % sidor.length;
    if (n !== 0) { visa(n); return; }

    // Nytt varv: ladda om sidan ibland, annars läs in inställningarna och bygg sidorna på nytt
    // (nytt datum => passerade dagar försvinner)
    if (new Date().getTime() - startad > OM_LADDNING_EFTER_MS) { location.reload(); return; }
    laddaInstallningar(function () { bygg(); visa(0); });
  }

  // Hämta sidan på nytt var 5:e minut och ladda om om innehållet ändrats (ny publicering).
  // Misslyckas hämtningen (t.ex. nätet ligger nere) behålls den sida som visas.
  var senasteInnehall = null;
  function kontrolleraUppdatering() {
    var x = new XMLHttpRequest();
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || x.status !== 200) return;
      if (senasteInnehall === null) { senasteInnehall = x.responseText; return; }
      if (x.responseText !== senasteInnehall) location.reload();
    };
    x.open('GET', location.pathname + '?t=' + new Date().getTime(), true);
    try { x.send(); } catch (e) { }
  }

  laddaInstallningar(function () { bygg(); visa(0); });
  kontrolleraUppdatering();
  setInterval(kontrolleraUppdatering, UPPDATERINGSKOLL_MS);
  setInterval(function () { uppdateraKlocka(); tonaNerPasserade(); }, 15000);
})();
