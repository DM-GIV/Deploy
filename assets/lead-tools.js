
(function () {
  function trackEvent(name, props) {
    if (typeof window.auctionCROTrack === 'function' && window.auctionCROTrack !== trackEvent) {
      window.auctionCROTrack(name, props || {});
      return;
    }
    // Preserve local events if shared funnel script is unavailable.
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event:name }, props || {}));
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    var copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied ? Promise.resolve() : Promise.reject(new Error('Clipboard unavailable'));
  }

  function openTelegramWithCopy(message, statusElement) {
    var win = window.open('https://t.me/Dmitry_G_Iv', '_blank', 'noopener');
    copyText(message).then(function () {
      if (statusElement) statusElement.textContent = 'Текст обращения скопирован. Вставьте его в открытый чат Telegram и проверьте перед отправкой.';
    }).catch(function () {
      if (statusElement) statusElement.textContent = 'Telegram открыт. Автоматически скопировать текст не удалось — передайте данные вручную.';
    });
    if (!win && statusElement) {
      statusElement.textContent = 'Браузер не открыл новую вкладку. Разрешите всплывающие окна или выберите e-mail / контакты ниже.';
    }
  }

  function openEmail(subject, message, statusElement) {
    if (statusElement) statusElement.textContent = 'Открываю почтовое приложение с подготовленным письмом.';
    window.location.href = 'mailto:dmitry.g.iv@yandex.ru?subject=' +
      encodeURIComponent(subject) + '&body=' + encodeURIComponent(message);
  }

  function renderCards(target, groups) {
    target.innerHTML = '';
    groups.forEach(function (group) {
      var card = document.createElement('div');
      card.className = 'check-card';
      var h = document.createElement('h4');
      h.textContent = group.title;
      var ul = document.createElement('ul');
      group.items.forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      });
      card.appendChild(h);
      card.appendChild(ul);
      target.appendChild(card);
    });
  }

  var lotForm = document.getElementById('lot-check-form-element');
  var lotResult = document.getElementById('lot-check-result');
  var lotChecks = document.getElementById('lot-result-checks');
  var lotIntro = document.getElementById('lot-result-intro');
  var lotStatus = document.getElementById('form-status');
  var handoffStatus = document.getElementById('handoff-status');
  var lotGenerated = false;

  function assetSpecificChecks(type) {
    var map = {
      'Недвижимость': [
        'Сопоставить адрес, площадь, назначение и идентификаторы объекта с доступными реестровыми сведениями.',
        'Проверить зарегистрированные права, ограничения и обременения по доступным официальным данным.',
        'Отдельно оценить вопросы доступа, фактического состояния, пользования и возможной передачи объекта.'
      ],
      'Автомобиль': [
        'Сопоставить VIN / иные идентификаторы, марку, модель, год и характеристики с документами лота.',
        'Проверить доступные сведения об ограничениях, залогах, розыске и регистрационных действиях.',
        'Оценить фактическое состояние, комплектность, место хранения и порядок передачи.'
      ],
      'Спецтехника': [
        'Сопоставить заводские номера, модель, год выпуска и иные идентификаторы техники.',
        'Проверить регистрационные документы, ограничения и фактическую комплектность.',
        'Уточнить состояние, место нахождения, возможность осмотра, погрузки и вывоза.'
      ],
      'Оборудование': [
        'Сопоставить состав, маркировку, серийные номера и комплектацию с описанием лота.',
        'Проверить документы на принадлежность и доступные сведения об ограничениях.',
        'Оценить демонтаж, погрузку, транспортировку, хранение и возможные расходы после покупки.'
      ],
      'Другое имущество': [
        'Точно идентифицировать предмет продажи и состав имущества.',
        'Проверить документы, подтверждающие принадлежность и условия распоряжения активом.',
        'Определить специфические расходы на получение, хранение, перевозку или дальнейшее использование.'
      ]
    };
    return map[type] || map['Другое имущество'];
  }

  function lotGroups(type, concern) {
    return [
      { title:'1. Объект', items: assetSpecificChecks(type) },
      { title:'2. Документы', items:[
        'Сверить описание лота с опубликованными документами и приложениями.',
        'Отметить отсутствующие или противоречивые сведения, без которых решение остаётся неопределённым.',
        'Проверить, какие данные требуют подтверждения из независимого или официального источника.'
      ]},
      { title:'3. Процедура торгов', items:[
        'Проверить сроки, размер и порядок внесения задатка, этап торгов и правила подачи предложения.',
        'Изучить условия оплаты, заключения договора, передачи имущества и возможные специальные требования.',
        'Проверить сообщения об изменении условий, отмене, результатах и связанных публикациях.'
      ]},
      { title:'4. Риски', items:[
        'Отделить подтверждённые факты от предположений и рекламного описания.',
        'Зафиксировать ограничения, споры, фактические препятствия и вопросы, которые нельзя подтвердить дистанционно.',
        'Отдельный фокус пользователя: ' + concern + '.'
      ]},
      { title:'5. Экономика', items:[
        'Считать не только цену торгов, но и оформление, получение, хранение, ремонт / подготовку и реализацию.',
        'Сопоставить итоговую себестоимость с доступными рыночными ориентирами.',
        'До участия определить предельную цену, выше которой сделка перестаёт соответствовать вашей цели.'
      ]}
    ];
  }

  function buildLotChecklistText() {
    var url = document.getElementById('lot-url').value.trim();
    var type = document.getElementById('asset-type').value;
    var concern = document.getElementById('concern-short').value;
    var extra = document.getElementById('concern').value.trim();
    var groups = lotGroups(type, concern);
    var lines = [
      'Предварительная карта проверки лота',
      'Ссылка: ' + url,
      'Тип имущества: ' + type,
      'Фокус: ' + concern
    ];
    if (extra) lines.push('Дополнительный вопрос: ' + extra);
    lines.push('');
    groups.forEach(function (group) {
      lines.push(group.title);
      group.items.forEach(function (item) { lines.push('— ' + item); });
      lines.push('');
    });
    lines.push('Важно: это предварительный чек-лист. Содержимое ссылки автоматически не анализировалось.');
    return lines.join('\n');
  }

  if (lotForm) {
    lotForm.addEventListener('input', function () {
      if (!lotGenerated) trackEvent('lot_check_start');
    }, { once:true });

    lotForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!lotForm.checkValidity()) {
        lotForm.reportValidity();
        if (lotStatus) lotStatus.textContent = 'Укажите корректную ссылку и тип имущества.';
        trackEvent('lot_check_error', { reason:'validation' });
        return;
      }

      var type = document.getElementById('asset-type').value;
      var concern = document.getElementById('concern-short').value;
      renderCards(lotChecks, lotGroups(type, concern));
      lotIntro.textContent = 'Для объекта типа «' + type + '» начните с пяти блоков ниже. Это карта вопросов, а не заключение по конкретному лоту.';
      lotResult.hidden = false;
      lotGenerated = true;
      if (lotStatus) lotStatus.textContent = '';
      trackEvent('lot_check_complete', { asset_type:type, concern:concern });
      lotResult.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  }

  // Invalidate a generated map when its inputs change.
  if (lotForm) lotForm.addEventListener('input', function () {
    if (lotGenerated) {
      lotGenerated = false;
      lotResult.hidden = true;
      document.getElementById('lot-handoff-preview').hidden = true;
      if (lotStatus) lotStatus.textContent = 'Данные изменены. Сформируйте карту проверки заново.';
    }
  });

  var copyLot = document.getElementById('copy-lot-check');
  if (copyLot) {
    copyLot.addEventListener('click', function () {
      copyText(buildLotChecklistText()).then(function () {
        copyLot.textContent = 'Скопировано';
        trackEvent('lot_check_copy');
        setTimeout(function(){ copyLot.textContent = 'Скопировать чек-лист'; }, 1800);
      });
    });
  }

  function buildLotHandoffMessage() {
    var contact = document.getElementById('contact').value.trim();
    var message = 'Здравствуйте! Хочу согласовать индивидуальную проверку лота: объём, стоимость и следующий шаг до участия.\n\n' +
      buildLotChecklistText();
    if (contact) message += '\nКонтакт для обратной связи: ' + contact;
    return message;
  }

  var searchForm = document.getElementById('search-brief-form');
  var searchResult = document.getElementById('search-brief-result');
  var searchSummary = document.getElementById('search-brief-summary');
  var searchChecks = document.getElementById('search-brief-checks');
  var searchStatus = document.getElementById('search-status');
  var searchGenerated = false;

  function buildSearchData() {
    return {
      type: document.getElementById('search-asset-type').value,
      region: document.getElementById('search-region').value.trim(),
      budget: document.getElementById('search-budget').value.trim(),
      goal: document.getElementById('search-goal').value
    };
  }

  function searchGroups(data) {
    return [
      { title:'1. Критерии входа', items:[
        'Тип имущества: ' + data.type + '.',
        'Регион: ' + data.region + '.',
        'Бюджет: ' + data.budget + '.',
        'Цель: ' + data.goal + '.'
      ]},
      { title:'2. Что фиксируем до поиска', items:[
        'Какие характеристики объекта являются обязательными, а какие можно обсуждать.',
        'Какой запас бюджета должен остаться на оформление, получение и последующие расходы.',
        'Какие риски недопустимы независимо от потенциальной скидки.'
      ]},
      { title:'3. Как фильтровать лоты', items:[
        'Не отбирать объект только по проценту скидки или стартовой цене.',
        'Сразу исключать варианты, по которым невозможно идентифицировать актив или оценить ключевые условия.',
        'Каждый прошедший фильтр переводить в отдельную проверку документов, рисков и экономики.'
      ]},
      { title:'4. Следующий шаг', items:[
        'Собрать несколько кандидатов по этим критериям.',
        'Для каждого сравнить полную стоимость входа и доступные рыночные ориентиры.',
        'Только после проверки конкретного лота принимать решение об участии.'
      ]}
    ];
  }

  function buildSearchText() {
    var data = buildSearchData();
    var lines = ['Задача на поиск имущества'];
    searchGroups(data).forEach(function(group){
      lines.push('', group.title);
      group.items.forEach(function(item){ lines.push('— ' + item); });
    });
    return lines.join('\n');
  }

  if (searchForm) {
    searchForm.addEventListener('input', function () {
      if (!searchGenerated) trackEvent('search_brief_start');
    }, { once:true });

    searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!searchForm.checkValidity()) {
        searchForm.reportValidity();
        return;
      }
      var data = buildSearchData();
      searchSummary.textContent = data.type + ' · ' + data.region + ' · ' + data.budget + ' · ' + data.goal;
      renderCards(searchChecks, searchGroups(data));
      searchResult.hidden = false;
      searchGenerated = true;
      trackEvent('search_brief_complete', { asset_type:data.type, goal:data.goal });
      searchResult.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  }

  if (searchForm) searchForm.addEventListener('input', function () {
    if (searchGenerated) {
      searchGenerated = false;
      searchResult.hidden = true;
      document.getElementById('search-handoff-preview').hidden = true;
      if (searchStatus) searchStatus.textContent = 'Критерии изменены. Сформируйте карту поиска заново.';
    }
  });

  var copySearch = document.getElementById('copy-search-brief');
  if (copySearch) {
    copySearch.addEventListener('click', function () {
      copyText(buildSearchText()).then(function () {
        copySearch.textContent = 'Скопировано';
        trackEvent('search_brief_copy');
        setTimeout(function(){ copySearch.textContent = 'Скопировать'; }, 1800);
      });
    });
  }

  function buildSearchHandoffMessage() {
    var contact = document.getElementById('search-contact').value.trim();
    var message = 'Здравствуйте! Хочу согласовать поиск и подбор имущества под мою задачу: объём, стоимость и следующий шаг.\n\n' +
      buildSearchText();
    if (contact) message += '\nКонтакт для обратной связи: ' + contact;
    return message;
  }

  // Only generate drafts locally. Sending happens only after an explicit click.
  function prepareEnquiry(kind) {
    var isLot = kind === 'lot';
    var ready = isLot ? lotGenerated : searchGenerated;
    var status = isLot ? handoffStatus : searchStatus;
    if (!ready) {
      if (status) status.textContent = 'Сначала сформируйте актуальную карту проверки или поиска.';
      return;
    }
    var preview = document.getElementById(kind + '-handoff-preview');
    var field = document.getElementById(kind + '-handoff-text');
    field.value = isLot ? buildLotHandoffMessage() : buildSearchHandoffMessage();
    preview.hidden = false;
    if (status) status.textContent = '';
    trackEvent('lead_draft_prepared', { source:isLot?'lot_check':'search_brief' });
    preview.scrollIntoView({ behavior:'smooth', block:'nearest' });
    field.focus({ preventScroll:true });
    // Optional direct-send integration is lazy; no network request on initial load.
    if (typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('lead:draft-ready', { detail:{ kind:kind } }));
    }
  }

  function sendPreparedEnquiry(kind, channel) {
    var field = document.getElementById(kind + '-handoff-text');
    var status = document.getElementById(kind + '-handoff-status');
    var message = field.value.trim();
    if (!message) {
      status.textContent = 'Добавьте текст обращения перед передачей.';
      field.focus();
      return;
    }
    var source = kind === 'lot' ? 'lot_check' : 'search_brief';
    if (channel === 'copy') {
      copyText(message).then(function () {
        status.textContent = 'Текст скопирован. Выберите удобный канал и отправьте его самостоятельно.';
        trackEvent('lead_draft_copy', { source:source });
      }).catch(function () { status.textContent = 'Не удалось скопировать текст. Выделите его и скопируйте вручную.'; });
      return;
    }
    if (channel === 'telegram') {
      // This opens a chat and copies the prepared message; it does not send it.
      openTelegramWithCopy(message, status);
      trackEvent('lead_handoff_opened', { source:source, channel:'telegram' });
      return;
    }
    if (channel === 'email') {
      var subject = kind === 'lot' ? 'Запрос на проверку лота с торгов' : 'Запрос на подбор имущества с торгов';
      openEmail(subject, message, status);
      trackEvent('lead_handoff_opened', { source:source, channel:'email' });
    }
  }

  [['lot','send-telegram'],['search','search-send-telegram']].forEach(function (config) {
    var button = document.getElementById(config[1]);
    if (button) button.addEventListener('click', function () { prepareEnquiry(config[0]); });
  });

  ['lot','search'].forEach(function (kind) {
    ['email','telegram','copy'].forEach(function (channel) {
      var button = document.getElementById(kind + '-handoff-' + channel);
      if (button) button.addEventListener('click', function () { sendPreparedEnquiry(kind, channel); });
    });
  });

  ['lot-check','search-brief'].forEach(function(id){
    var section = document.getElementById(id);
    if (section && 'IntersectionObserver' in window) {
      var seen = false;
      var observer = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if (!seen && entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            seen = true;
            trackEvent(id === 'lot-check' ? 'lot_check_view' : 'search_brief_view');
            observer.disconnect();
          }
        });
      }, { threshold:[0.35] });
      observer.observe(section);
    }
  });
})();
