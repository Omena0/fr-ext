var PARAM = '879d32d11578b7477716b35d4dfc5730';
var LANG = 'fi';
var ACCESSCODE = PARAM.substring(0, 32);
var SITE_ID = PARAM.substring(32);

var context = {};
var all_questions = []; // for all questions for this quiz
var questions = []; // for selected questions
var answers = []; // boolean array of correct answers (same index with questions)
var passed_questions = []; // boolean array of passed questions (same index with questions)
var progress = "ready"; // ready  running  complete  timeout
var result = ""; //  success  fail
var bar;
var score = 0;
var rec; // updating record for Person_Quiz
var user = "quiz";
var pass = "foo";
var time_question = 120; // constant: 120 s per question
var time = 120; // total time (recalculated later)
var s = 0; // elapsed time (seconds)
var labels = {}; // translations

var EOS = false; // force "en osaa sanoa" to all questions
var NEXT_BUTTON = true; // after answering question, do we display "next" button or move forward automatically?

// states of quiz: 'pending'  --> 'running'
// end states of quiz: for COURSE TEST, 'passed' 'fail'. For competence test,  'completed' or 'timeout'

function lbl(x) {
  if (labels.hasOwnProperty(x)) return labels[x];
  else return "--"; // to avoid error if label (transalation) is not found
}

$(function () {
  if (PARAM == "") return; // no hash imported in URL, die
  user = "quiz";
  pass = PARAM; // use PARAM on access, it may include site id, too
  $("#qzstart").hide();
  coco_load_lang("quiz", LANG, user, pass, function (foo) {
    labels = foo;
    init2();
  });
});

function init2() {
  var msg = "";
  coco_load_query("p-qz-q", ACCESSCODE, user, pass, function (data) {
    if (data.length > 0) load_quiz(data);
    else coco_load_query("p-qz-q", PARAM, user, pass, function (data) {
      if (data.length > 0) load_quiz(data);
      else {
        $("#qztitle").html("Quiz not found");
        $("#qzstart").hide();
        return;
      }
    });
  });
}

function load_quiz(data) {
  if (data.length < 1) {
    $("#qzstart").hide();
    return;
  }
  if ((data[0].status != 'pending') && (data[0].public_quiz == 0)) {
    $("#qztitle").html(lbl('quiz010'));
    $("#qzstart").hide();
    $("#qzaction").hide();
    return;
  }
  context = data[0];
  context.course_test = context.course_test == 1;

  var term = 'quiz_id = ' + data[0].quiz_id + ' and person_id = ' + data[0].id + " and status='passed'";
  coco_load_resource('Person_Quiz', encodeURIComponent(term), 'all', user, pass, function (data) {
    if (data.length > 0) {
      $("#qztitle").html(lbl('quiz020'));
      $("#qzstart").hide();
      return;
    }
    coco_load_query("qz-q", context.quiz_id, user, pass, function (data) {
      all_questions = data;
      var qset = "";
      for (var i = 0; i < all_questions.length; i++) qset += all_questions[i].id + ';';
      qset = qset.substring(0, qset.length - 1);
      init3();
    });
  });
}

function init3() {
  if (all_questions.length < context.max_questions) context.max_questions = all_questions.length;
  all_questions.sort(function () { return 0.5 - Math.random(); });
  if (context.course_test) {
    questions = all_questions.slice(0, context.max_questions);
    time = time_question * context.max_questions;
  }
  init4();
}

function init4() {
  $("#qztitle").html(context.title);
  $("#qztime").html(String(Math.floor(time / 60)));
  var html = "";
  for (var j = 0; j < questions.length; j++) {
    html += '<div class="coco_question_circle"></div>';
  }
  html += ' <div class="parrot_content"></div>';
  $("#qzresults").html(html);
  $("#qzstart").show();
}

// "start" button pressed
function start() {
  if (progress != "ready") return;
  rec = {
    id: context.person_quiz_id,
    person_id: context.id,
    quiz_id: context.quiz_id,
    date: new Date().toISOString().substring(0, 10),
    score: '0',
    status: 'started',
    accesscode: context.accesscode
  };
  coco_update_resource("Person_Quiz", rec, user, pass, function () {});
  bar = setInterval(draw_bar, 1000);
  progress = "running";
  show_question();
  $("#qzstart").hide();
  $("#qzaction").show();
}

// time elapsed
function draw_bar() {
  s++;
  var w = s / time * 100;
  if (s > time) {
    clearInterval(bar);
    timeout();
  }
  var html = '<div class="progress-bar" role="progressbar" aria-valuenow="' + w +
    '" aria-valuemin="0" aria-valuemax="100" style="width: ' + w +
    '%;"><span class="sr-only">' + w + '% Complete</span></div>';
  $("#qzprogress").html(html);
}

// introduce some global variables for easy access
var q = null; // current question object
var qtype = ""; //  multi  yesno  value
var clist = []; // choice list
var queco = 0; // question count
var action_button = "answer"; // toggles  "answer"  "next"
var last = false;

function show_question() {
  q = questions[queco];
  $("#qzquestion").html(q.question.replace("\n", "<br/>"));
  qtype = "multi";
  var html = "";
  if (q.info.length < 5) {
    qtype = "value";
    if ((q.correct == "yes") || (q.correct == "no")) qtype = "yesno";
  }
  if (qtype == "multi") {
    clist = JSON.parse(q.info);
    clist.sort(function () { return 0.5 - Math.random(); });
    if (EOS) clist.push({ choice: lbl('quiz040'), ok: false });
    for (var ck = 0; ck < clist.length; ck++) {
      html += '<div class="coco_option checkbox btn btn-default"><label><input type="checkbox" id="choice' + ck + '"/>' + clist[ck].choice + '</label></div>';
    }
  }
  if (qtype == "yesno") {
    html =
      '<div class="coco_option radio btn btn-default"><label><input type="radio" value="yes" name="radio">' + lbl('quiz050') + '</label></div>' +
      '<div class="coco_option radio btn btn-default"><label><input type="radio" value="no" name="radio">' + lbl('quiz060') + '</label></div>';
    if (EOS) html += '<div class="coco_option radio btn btn-default"><label><input type="radio" value="eos" name="radio">' + lbl('quiz040') + '</label></div>';
  }
  if (qtype == "value")
    html = lbl('quiz070') + ': <input type="text" id="answer"/>';
  $("#qzoptions").html(html);
}

function answer() {
  var is_answer = false;
  if (qtype == "multi")
    for (var i = 0; i < clist.length; i++)
      if ($("#choice" + i).is(':checked')) is_answer = true;
  if (qtype == "yesno")
    if (["yes", "no", "eos"].indexOf($('input[name=radio]:checked').val()) != -1) is_answer = true;
  if (!is_answer) {
    alert(lbl('quiz080'));
    return;
  }
  if (action_button == "next") {
    next();
    return;
  }
  if (queco == questions.length - 1) last = true;

  var ok = true;
  var pss = false;

  if (qtype == "value") {
    ok = $("#answer").val().trim() == q.correct;
    if ($("#answer").val().trim() == "") pss = true;
  }
  if (qtype == "yesno") {
    ok = $('input[name=radio]:checked').val() == q.correct;
    if ($('input[name=radio]:checked').val() == "eos") pss = true;
  }
  if (qtype == "multi") {
    for (var k = 0; k < clist.length; k++) {
      if ($("#choice" + k).is(':checked') != clist[k].ok) ok = false;
    }
    var last_choice = clist.length - 1;
    if (EOS && $("#choice" + last_choice).is(':checked')) pss = true;
  }
  answers.push(ok);
  passed_questions.push(pss);

  var html = "";
  for (var j = 0; j < questions.length; j++) {
    if (j > queco) {
      html += '<div class="coco_question_circle"></div>';
    } else if (answers[j]) {
      html += '<div class="coco_question_circle done"></div>';
    } else if (passed_questions[j]) {
      html += '<div class="coco_question_circle gray"></div>';
    } else {
      html += '<div class="coco_question_circle fail"></div>';
    }
  }
  $("#qzresults").html(html);

  if (!pss) {
    if (ok && (q.correct_msg != null))
      $("#qzfeedback").html(q.correct_msg + '<br/><i>' + q.correct_why + '</i>');
    else
      $("#qzfeedback").html(q.incorrect_msg);
  }

  if (last) {
    clearInterval(bar);
    var msg = lbl('quiz090');
    progress = "complete";
    result = "success";
    $("#qzstart").html('<p class="text-center">' + msg + '</p>');
    show_results();
  } else {
    if (NEXT_BUTTON) {
      $("#qzaction").html('<b>' + lbl('quiz100') + '</b>');
      action_button = "next";
    } else {
      next();
    }
  }
}

function next() {
  queco++;
  action_button = "answer";
  $("#qzaction").html('<b>' + lbl('quiz110') + '</b>');
  $("#qzfeedback").html('');
  show_question();
}

function timeout() {
  var html = lbl('quiz120');
  if (progress == "running") {
    html += lbl('quiz130');
    progress = "timeout";
    result = "fail";
  } else {
    html += lbl('quiz140');
  }
  $("#qzstart").show();
  $("#qzstart").html(html);
  show_results();
}

function show_results() {
  var sc = 0;
  for (var i = 0; i < answers.length; i++) if (answers[i]) sc++;
  var pss = 0;
  for (var j = 0; j < passed_questions.length; j++) if (passed_questions[j]) pss++;

  rec.total = questions.length;
  rec.correct = sc;
  rec.passed = pss;
  rec.status = progress;
  if (context.course_test) {
    if (rec.correct >= context.accept_min) rec.status = "passed";
    else rec.status = 'failed';
  }
  rec.results = {};

  $("#qzquestion").hide();
  $("#qzoptions").hide();
  $("#qzaction").hide();
  $("qzfeedback").hide();

  $("#qzstart").show();

  var html = "";
  if (rec.status != "passed") {
    html += "<b>" + context.fail_msg + "</b>";
  } else {
    var url = window.location.protocol + '//' + window.location.host + "/quiz/cert/" + PARAM;
    html += '<b>' + context.success_msg + '</b><br/><br/>' + lbl('quiz170') + '<br/><br/>';
  }
  $("#qzstart").html(html);

  coco_update_resource("Person_Quiz", rec, user, pass, function () {});

  if (rec.status == "passed") {
    console.log("Now entering ajax " + '/api/aesir/' + rec.id + ' as user ' + user + ' pass ' + pass);
    $.ajax({
      url: window.location.protocol + '//' + window.location.host + '/api/aesir/' + rec.id,
      type: 'GET',
      contentType: 'application/json; charset=UTF-8',
      dataType: 'json',
      beforeSend: function (xhr) {
        xhr.setRequestHeader('Authorization', 'Basic ' + btoa(user + ":" + pass));
      }
    }).done(function (data) {
      console.log(JSON.stringify(data));
    }).fail(function (xhr) {
      console.log("Fail (Aesir access): " + xhr.status);
    });
  }
}
