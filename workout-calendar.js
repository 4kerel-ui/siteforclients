/**
 * WorkoutCalendar Module
 * Компонент календаря тренировок.
 * 
 * Строит календарную сетку на основе реальных дат и данных из WorkoutService.
 * Полностью отделен от статических чисел: все отметки читаются из хранилища.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const mod = factory();
    root.WorkoutCalendar = mod.WorkoutCalendar;
    root.WorkoutCalendarModule = mod;
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const MONTH_NAMES = [
    '', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  /**
   * Количество дней в месяце (1-based month)
   */
  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  /**
   * Смещение первого дня месяца (Понедельник = 0, Воскресенье = 6)
   */
  function getFirstDayOffset(year, month) {
    const jsDay = new Date(year, month - 1, 1).getDay(); // 0 = Вс, 1 = Пн
    return (jsDay + 6) % 7;
  }

  /**
   * Форматирование даты в ключ YYYY-MM-DD
   */
  function formatDateKey(year, month, day) {
    const m = String(month).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  }

  class WorkoutCalendar {
    constructor(options = {}) {
      this.container = typeof options.container === 'string'
        ? document.querySelector(options.container)
        : options.container;

      this.service = options.service || (typeof window !== 'undefined' ? window.WorkoutService : null);
      
      // По умолчанию отображаем Ноябрь 2026 года (текущий рабочий месяц)
      this.year = options.initialYear || 2026;
      this.month = options.initialMonth || 11;

      // Доступные для переключения месяцы первого этапа
      this.allowedMonths = options.allowedMonths || [
        { year: 2026, month: 10, label: 'Октябрь 2026' },
        { year: 2026, month: 11, label: 'Ноябрь 2026' }
      ];

      this.selectedDate = options.initialSelectedDate || '2026-11-15';
      this.onSelectWorkout = options.onSelectWorkout || null;

      this._workoutsCache = new Map();
    }

    /**
     * Загрузить данные из сервиса и обновить кеш
     */
    async loadWorkouts() {
      if (!this.service) return;
      const all = await this.service.getAllWorkouts();
      this._workoutsCache.clear();
      for (const w of all) {
        if (w.scheduledDate) {
          this._workoutsCache.set(w.scheduledDate, w);
        }
      }
    }

    /**
     * Переключить отображаемый месяц
     */
    async setMonth(year, month) {
      this.year = year;
      this.month = month;
      await this.render();
    }

    /**
     * Отрисовать календарь
     */
    async render() {
      if (!this.container) return;

      await this.loadWorkouts();

      const daysCount = getDaysInMonth(this.year, this.month);
      const startOffset = getFirstDayOffset(this.year, this.month);

      // Генерация переключателя месяцев
      const tabsHtml = this.allowedMonths.map(m => {
        const isActive = m.year === this.year && m.month === this.month;
        return `
          <button 
            type="button" 
            class="cal-month-btn ${isActive ? 'active' : ''}" 
            data-year="${m.year}" 
            data-month="${m.month}"
          >
            ${m.label}
          </button>
        `;
      }).join('');

      // Шапка дней недели
      const weekdaysHtml = WEEKDAYS_SHORT.map(wd => `
        <div class="cal-weekday">${wd}</div>
      `).join('');

      // Ячейки смещения предыдущего месяца
      let daysHtml = '';
      for (let i = 0; i < startOffset; i++) {
        daysHtml += `<div class="cal-day other-month"></div>`;
      }

      // Ячейки дней текущего месяца
      for (let day = 1; day <= daysCount; day++) {
        const dateKey = formatDateKey(this.year, this.month, day);
        const workout = this._workoutsCache.get(dateKey);
        const isSelected = dateKey === this.selectedDate;
        const isToday = dateKey === '2026-11-15';

        let classList = ['cal-day'];
        let statusBadge = '';
        let ariaLabel = `${day} ${MONTH_NAMES[this.month]} ${this.year}`;

        if (workout) {
          classList.push('has-workout');
          if (workout.status === 'completed') {
            classList.push('completed');
            statusBadge = `<span class="cal-status-icon completed" title="Выполнена">✔</span>`;
            ariaLabel += ` — Тренировка выполнена: ${workout.title}`;
          } else if (workout.status === 'started') {
            classList.push('started');
            statusBadge = `<span class="cal-status-icon started" title="В процессе">⚡</span>`;
            ariaLabel += ` — Тренировка в процессе: ${workout.title}`;
          } else {
            classList.push('planned');
            statusBadge = `<span class="cal-status-icon planned" title="Запланирована">•</span>`;
            ariaLabel += ` — Тренировка запланирована: ${workout.title}`;
          }
        } else {
          classList.push('free-day');
          ariaLabel += ` — День отдыха`;
        }

        if (isToday) {
          classList.push('today');
        }
        if (isSelected) {
          classList.push('selected');
        }

        daysHtml += `
          <button 
            type="button" 
            class="${classList.join(' ')}" 
            data-date="${dateKey}"
            aria-label="${ariaLabel}"
          >
            <span class="cal-day-num">${day}</span>
            ${statusBadge}
          </button>
        `;
      }

      // Сборка всего компонента
      this.container.innerHTML = `
        <div class="workout-calendar-root">
          <div class="cal-header">
            <div class="cal-title-block">
              <span class="cal-icon">📅</span>
              <h3 class="cal-title">Календарь тренировок</h3>
            </div>
            <div class="cal-month-tabs">
              ${tabsHtml}
            </div>
          </div>

          <div class="cal-weekdays-grid">
            ${weekdaysHtml}
          </div>

          <div class="cal-days-grid">
            ${daysHtml}
          </div>

          <!-- Легенда обозначений -->
          <div class="cal-legend">
            <div class="cal-legend-item">
              <span class="legend-chip completed">✔</span>
              <span>Выполнена</span>
            </div>
            <div class="cal-legend-item">
              <span class="legend-chip planned">•</span>
              <span>Запланирована</span>
            </div>
            <div class="cal-legend-item">
              <span class="legend-chip today"></span>
              <span>15 ноября (Сегодня)</span>
            </div>
            <div class="cal-legend-item">
              <span class="legend-chip free"></span>
              <span>Свободный день</span>
            </div>
          </div>

          <!-- Интерактивная плашка выбранного дня -->
          <div class="cal-selection-banner" id="cal-selected-info">
            <!-- Заполняется при клике -->
          </div>
        </div>
      `;

      // Привязка событий переключения месяцев
      this.container.querySelectorAll('.cal-month-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const y = parseInt(e.currentTarget.getAttribute('data-year'), 10);
          const m = parseInt(e.currentTarget.getAttribute('data-month'), 10);
          this.setMonth(y, m);
        });
      });

      // Привязка событий клика по дням
      this.container.querySelectorAll('.cal-day[data-date]').forEach(dayBtn => {
        dayBtn.addEventListener('click', (e) => {
          const dateStr = e.currentTarget.getAttribute('data-date');
          this.selectDate(dateStr);
        });
      });

      // Первичная отрисовка выбранного дня
      this._updateSelectedInfo(this.selectedDate);
    }

    /**
     * Обработка выбора дня в календаре
     */
    async selectDate(dateStr) {
      this.selectedDate = dateStr;

      // Обновляем визуальный класс selected
      this.container.querySelectorAll('.cal-day').forEach(el => {
        el.classList.toggle('selected', el.getAttribute('data-date') === dateStr);
      });

      // Извлекаем тренировку из хранилища через сервис
      const workout = this.service ? await this.service.getWorkoutByDate(dateStr) : null;

      // Вызываем колбек, если передан
      if (typeof this.onSelectWorkout === 'function') {
        this.onSelectWorkout(workout, dateStr);
      }

      this._updateSelectedInfo(dateStr, workout);
    }

    /**
     * Обновление панели выбранного дня (без модального окна)
     */
    _updateSelectedInfo(dateStr, workout) {
      const banner = this.container.querySelector('#cal-selected-info');
      if (!banner) return;

      const [y, m, d] = dateStr.split('-');
      const formattedDate = `${parseInt(d, 10)} ${MONTH_NAMES[parseInt(m, 10)]} ${y}`;

      if (!workout) {
        workout = this._workoutsCache.get(dateStr) || null;
      }

      if (workout) {
        const statusText = workout.status === 'completed'
          ? '<span class="status-tag success">✔ Выполнена</span>'
          : workout.status === 'started'
          ? '<span class="status-tag warning">⚡ В процессе</span>'
          : '<span class="status-tag planned">⏳ Запланирована</span>';

        const setsCount = Array.isArray(workout.content) ? workout.content.length : 0;
        let totalEx = 0;
        if (Array.isArray(workout.content)) {
          workout.content.forEach(s => totalEx += (s.exercises ? s.exercises.length : 0));
        }

        banner.innerHTML = `
          <div class="selected-content has-data">
            <div class="selected-top">
              <span class="selected-date">${formattedDate}</span>
              ${statusText}
            </div>
            <div class="selected-title">${workout.title}</div>
            <div class="selected-meta">${setsCount} сета • ${totalEx} упражнений • ID: <code>${workout.id}</code></div>
          </div>
        `;
      } else {
        banner.innerHTML = `
          <div class="selected-content empty">
            <span class="selected-date">${formattedDate}</span>
            <div class="selected-empty-text">🧘‍♀️ Свободный день (тренировка не запланирована)</div>
          </div>
        `;
      }
    }
  }

  return {
    WorkoutCalendar,
    getDaysInMonth,
    getFirstDayOffset,
    formatDateKey
  };
}));
