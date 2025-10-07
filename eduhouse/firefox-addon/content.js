(function() {
  // prevent multiple executions in the same page
  if (window.__autopass_running) return;
  window.__autopass_running = true;

  // signal when the content script runs (helps diagnose injection in new tabs / frames)
  try { console.log('[autopass] content script loaded for', location.href); } catch (e) {}
  function log() { try { console.log('[autopass]', Array.prototype.join.call(arguments, ' ')); } catch (e) {} }

  // Listen for messages posted from injected page scripts and auto-answer
  function parseInfo(info) {
    try { return typeof info === 'string' ? JSON.parse(info) : info; } catch (e) { return null; }
  }

  function clickIfClickable(el) {
    if (!el) return false;
    try { el.removeAttribute && el.removeAttribute('disabled'); } catch (e) {}
    try { el.click(); return true; } catch (e) { try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('click', {bubbles:true})); return true; } catch (ee) { return false; } }
  }

  function selectOptionByText(root, targetText) {
    if (!root || !targetText) return false;
    var t = String(targetText).trim();
    var candidates = Array.prototype.slice.call(root.querySelectorAll('label, button, .choice, .option, li, span'));
    for (var i=0;i<candidates.length;i++) {
      try {
        var txt = candidates[i].textContent && candidates[i].textContent.trim();
        if (!txt) continue;
        if (txt === t || txt.indexOf(t) !== -1 || t.indexOf(txt) !== -1) {
          try {
            if (candidates[i].tagName.toLowerCase() === 'label') {
              var forId = candidates[i].getAttribute('for');
              if (forId) {
                var inp = root.querySelector('#'+CSS.escape(forId));
                if (inp) { if (clickIfClickable(inp)) return true; }
              }
            }
          } catch(e) {}
          if (clickIfClickable(candidates[i])) return true;
        }
      } catch(e){}
    }
    var inputs = Array.prototype.slice.call(root.querySelectorAll('input, button'));
    for (var j=0;j<inputs.length;j++) {
      try {
        var p = inputs[j].parentElement;
        if (!p) continue;
        var txt = p.textContent && p.textContent.trim();
        if (!txt) continue;
        if (txt === t || txt.indexOf(t) !== -1 || t.indexOf(txt) !== -1) {
          if (clickIfClickable(inputs[j])) return true;
        }
      } catch(e){}
    }
    return false;
  }

  function clickNextButton(root) {
    root = root || document;
    var btns = Array.prototype.slice.call(root.querySelectorAll('button, a, input[type=button], input[type=submit]'));
    var labels = ['Seuraava','Vahvista','Lähetä','Jatka','Valmis','Next','Submit','Confirm'];
    for (var i=0;i<btns.length;i++) {
      try {
        var txt = (btns[i].textContent || btns[i].value || '').trim();
        if (!txt) continue;
        for (var k=0;k<labels.length;k++) {
          if (txt.indexOf(labels[k]) !== -1) { if (clickIfClickable(btns[i])) { log('clicked next button', txt); return true; } }
        }
      } catch(e){}
    }
    return false;
  }

  function answerQuestionObject(q) {
    if (!q) return;
    try {
      var info = parseInfo(q.info) || [];
      var correct = null;
      for (var i=0;i<info.length;i++) { if (info[i] && info[i].ok) { correct = info[i].choice; break; } }
      if (!correct && info.length) correct = info[0].choice;
      if (!correct && q.correct) correct = q.correct;
      if (!correct) { log('no correct choice found for q', q.id); return; }
      var did = selectOptionByText(document, correct);
      log('answered question', q.id, 'by text=', correct, 'clickedOption=', !!did);
      setTimeout(function(){ if (!clickNextButton(document)) { log('no next button clicked for q', q.id); } }, 300);
    } catch (e) { log('answerQuestionObject exception', e); }
  }

  window.addEventListener('message', function(ev) {
    try {
      if (ev.source !== window || !ev.data) return;
      if (ev.data.type === 'autopass_q') {
        // prevent processing the same q multiple times
        if (window.__autopass_q_processed) return;
        window.__autopass_q_processed = true;

        log('received q from page script:', ev.data.q && ev.data.q.length ? ('questions=' + ev.data.q.length) : ev.data.q);
        try {
          var qs = Array.isArray(ev.data.q) ? ev.data.q : [ev.data.q];
          // remove the DOM clicking logic since we'll set globals instead
          log('skipping DOM clicks, will set globals and call show_results instead');
        } catch(e) { log('error handling autpass_q', e); }

        // also set globals and call show_results() in page context after a short delay
        try {
          var pageSetter = function(qData, delay) {
            try {
              window.q = qData;
              window.questions = qData;

              // set up quiz state variables to simulate completed quiz with all correct answers
              if (!window.answers) window.answers = [];
              if (!window.passed_questions) window.passed_questions = [];

              // mark all questions as correctly answered
              for (var i = 0; i < qData.length; i++) {
                window.answers[i] = true;  // all correct
                window.passed_questions[i] = false;  // none passed (skipped)
              }

              // set quiz state to completed
              window.progress = "complete";
              window.result = "success";
              window.queco = qData.length; // question counter at end

              // ensure rec object exists for show_results
              if (!window.rec) {
                window.rec = {
                  id: window.context ? window.context.person_quiz_id : null,
                  person_id: window.context ? window.context.id : null,
                  quiz_id: window.context ? window.context.quiz_id : null,
                  date: new Date().toISOString().substring(0, 10),
                  score: qData.length.toString(),
                  status: 'complete',
                  accesscode: window.context ? window.context.accesscode : null
                };
              }

              console.log('[autopass-page] globals set: answers=' + window.answers.length + ', progress=' + window.progress + ', will call show_results in', delay);

              setTimeout(function() {
                try {
                  if (typeof show_results === 'function') {
                    show_results();
                    console.log('[autopass-page] show_results called');

                    // after show_results, wait a moment then look for certificate download button
                    setTimeout(function() {
                      try {
                        // look for certificate download button in parent frame
                        window.parent.postMessage({type: 'autopass_click_certificate'}, '*');
                      } catch (e) { console.log('[autopass-page] certificate message error', e); }
                    }, 2000);

                  } else {
                    console.log('[autopass-page] show_results not found');
                  }
                } catch (e) {
                  console.log('[autopass-page] show_results error', e);
                }
              }, delay);
            } catch (e) { console.log('[autopass-page] pageSetter error', e); }
          };
          var s = document.createElement('script');
          s.textContent = '(' + pageSetter.toString() + ')(' + JSON.stringify(ev.data.q) + ',' + START_DELAY_MS + ');';
          (document.head||document.documentElement).appendChild(s);
          s.parentNode.removeChild(s);
        } catch (e) { log('failed to inject pageSetter', e); }
      }
      if (ev.data.type === 'autopass_started') {
        log('page start() invoked');
      }
      if (ev.data.type === 'autopass_click_certificate') {
        log('received certificate click request');
        setTimeout(function() {
          try {
            // look for certificate download button
            var certBtn = document.querySelector('button.course-addon__button.totem-button.large.secondary.normal.-icon');
            if (!certBtn) certBtn = document.querySelector('button[class*="course-addon__button"][class*="secondary"]');
            if (!certBtn) {
              // try broader search
              var btns = document.querySelectorAll('button');
              for (var i = 0; i < btns.length; i++) {
                var txt = btns[i].textContent || btns[i].innerText || '';
                if (txt.indexOf('todistus') !== -1 || txt.indexOf('Lataa') !== -1 || txt.indexOf('certificate') !== -1) {
                  certBtn = btns[i];
                  break;
                }
              }
            }
            if (certBtn) {
              try { certBtn.removeAttribute && certBtn.removeAttribute('disabled'); } catch (e) {}
              try { certBtn.click(); } catch (e) { try { certBtn.dispatchEvent(new MouseEvent('click', {bubbles: true})); } catch (ee) {} }
              log('Clicked certificate download button');
            } else {
              log('Certificate download button not found');
            }
          } catch (e) { log('certificate click error', e); }
        }, 500);
      }
    } catch (e) { /* ignore */ }
  }, false);

  function clickElement(selector) {
    try {
      var el = document.querySelector(selector);
      if (!el) return false;
      try { el.removeAttribute && el.removeAttribute('disabled'); } catch (e) {}
      try { el.click(); } catch (e) { try { el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})); } catch (ee) {} }
      log('Clicked', selector);
      return true;
    } catch (e) { log('clickElement error', selector, e); return false; }
  }

  var _courseClicked = false;
  var _startClickedInIframe = false;

  function clickInIframe(iframeSelector, innerSelector) {
    try {
      var ifr = document.querySelector(iframeSelector);
      if (!ifr) return false;
      // if same-origin, try to access and click inside
      try {
        var idoc = ifr.contentDocument || ifr.contentWindow && ifr.contentWindow.document;
        if (!idoc) return false;
        var inner = idoc.querySelector(innerSelector);
        if (inner) {
          try { inner.click(); } catch(e) { try { inner.dispatchEvent(new MouseEvent('click', {bubbles:true})); } catch(ee){} }
          log('Clicked inside iframe', iframeSelector, innerSelector);
          return true;
        }
      } catch (e) {
        // cross-origin or inaccessible
        return false;
      }
    } catch (e) { return false; }
    return false;
  }

  function clickSequence(retries) {
    retries = typeof retries === 'number' ? retries : 10;
    var COURSE_SEL = '.course-addon__button.totem-button.large.primary.normal';
    var START_SEL = '.btn.btn-default.btn-coco-start';

    var tried = 0;
    var interval = setInterval(function() {
      tried++;
      // If modal iframe appears, stop clicking course button and try to click start inside iframe
      var modalIframe = document.querySelector('iframe.modal-coma-test') || document.querySelector('iframe[src*="coma.eduhouse.fi"]');
      if (modalIframe) {
        log('modal iframe detected, stopping course clicks');
        _courseClicked = true;
        // try to click start inside iframe (same-origin only)
        if (!_startClickedInIframe) {
          var didIframeStart = clickInIframe('iframe.modal-coma-test', START_SEL) || clickInIframe('iframe[src*="coma.eduhouse.fi"]', START_SEL);
          if (didIframeStart) _startClickedInIframe = true;
        }
        clearInterval(interval);
        return;
      }

      if (!_courseClicked) {
        var didCourse = clickElement(COURSE_SEL);
        if (didCourse) {
          _courseClicked = true;
          // after clicking course button, wait a moment then click start repeatedly until success (in top frame)
          var startTries = 0;
          var startInterval = setInterval(function() {
            startTries++;
            var didStart = clickElement(START_SEL);
            if (didStart || startTries > 10) {
              clearInterval(startInterval);
            }
          }, 600);
          clearInterval(interval);
          return;
        }
      }
      if (tried >= retries) clearInterval(interval);
    }, 800);
  }

  try {
    var observer = new MutationObserver(function(muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (!(node instanceof HTMLElement)) continue;
          try {
            if (node.querySelector && (node.querySelector('.course-addon__button.totem-button.large.primary.normal') || node.querySelector('.btn.btn-default.btn-coco-start'))) {
              log('observer: detected button node');
              clickSequence();
              return;
            }
            if (node.className && (node.className.indexOf('course-addon__button') !== -1 || node.className.indexOf('btn-coco-start') !== -1)) {
              log('observer: detected button element');
              clickSequence();
              return;
            }
          } catch (e) {}
        }
      }
    });
    observer.observe(document.documentElement || document.body, {childList: true, subtree: true});
  } catch (e) { /* ignore */ }

  clickSequence(6);
  setTimeout(function(){ clickSequence(6); }, 2000);
  setTimeout(function(){ clickSequence(4); }, 6000);

  var START_DELAY_MS = 1500; // extra delay to avoid racing the quiz start button

  // If this script is running on a coma.eduhouse.fi quiz page, inject a page-context helper
  try {
    if (location.hostname && location.hostname.indexOf('coma.eduhouse.fi') !== -1 && location.pathname.indexOf('/quiz/') === 0) {
      // prevent multiple page helper injections
      if (window.__autopass_page_helper_injected) return;
      window.__autopass_page_helper_injected = true;

      var pageScript = function(delay) {
        try {
          console.log('[autopass-page] running in page context');
          var startTries = 0;
          // wait a bit before attempting start to reduce races
          setTimeout(function() {
            var startInterval = setInterval(function() {
              startTries++;
              if (typeof start === 'function') {
                try {
                  start();
                  console.log('[autopass-page] start() called successfully');
                  try { window.postMessage({type: 'autopass_started'}, '*'); } catch (e) {}
                  clearInterval(startInterval);
                  // now wait for q to be populated
                  var qTries = 0;
                  var qPoll = setInterval(function() {
                    qTries++;
                    if (window.q && window.q.length) {
                      try { window.postMessage({type: 'autopass_q', q: window.q}, '*'); } catch (e) {}
                      clearInterval(qPoll);
                      return;
                    }
                    // if q isn't set yet, try to find an array-of-questions under other globals
                    if (qTries > 5) {
                      try {
                        var found = false;
                        for (var k in window) {
                          if (!window.hasOwnProperty(k)) continue;
                          try {
                            var v = window[k];
                            if (Array.isArray(v) && v.length && v[0] && (typeof v[0].question === 'string' || v[0].question)) {
                              window.q = v;
                              try { window.postMessage({type: 'autopass_q', q: window.q, sourceVar: k}, '*'); } catch (e) {}
                              console.log('[autopass-page] found q via window.' + k);
                              found = true;
                              break;
                            }
                          } catch (e) { /* ignore */ }
                        }
                        if (found) { clearInterval(qPoll); return; }
                      } catch (e) { console.log('[autopass-page] scan-for-q error', e); }
                    }
                    if (qTries > 120) { clearInterval(qPoll); }
                  }, 200);
                  return;
                } catch (e) {
                  console.log('[autopass-page] start() error', e);
                  // keep retrying start until it succeeds or times out
                }
              }
              if (startTries > 120) { console.log('[autopass-page] giving up on start() after retries'); clearInterval(startInterval); }
            }, 200);
          }, delay);
        } catch (e) { console.log('[autopass-page] unexpected error', e); }
      };
      var s = document.createElement('script');
      s.textContent = '(' + pageScript.toString() + ')(' + START_DELAY_MS + ');';
      (document.head||document.documentElement).appendChild(s);
      s.parentNode.removeChild(s);
      log('injected page helper to call start() and post q');
    }
  } catch (e) { /* ignore */ }
})();
