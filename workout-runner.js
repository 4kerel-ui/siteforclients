/**
 * WorkoutRunner Module
 * Модуль экрана выполнения тренировки.
 * 
 * - Запускает тренировку (перевод в статус "started").
 * - Отображает тренировочную программу (сеты, упражнения, схемы, заметки).
 * - По клику на упражнение открывает модальное окно с техникой (YouTube / GIF / Фото).
 * - В конце тренировки предоставляет кнопку "Завершить тренировку".
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const mod = factory();
    root.WorkoutRunner = mod.WorkoutRunner;
    root.WorkoutRunnerModule = mod;
  }
}(typeof self !== 'undefined' ? self : this, function () {

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  class WorkoutRunner {
    constructor(options = {}) {
      this.container = typeof options.container === 'string'
        ? document.querySelector(options.container)
        : options.container;

      this.service = options.service || (typeof window !== 'undefined' ? window.WorkoutService : null);
      this.onBack = options.onBack || null;
      this.onComplete = options.onComplete || null;
      this.onOpenTechnique = options.onOpenTechnique || null;
      this.onCloseTechnique = options.onCloseTechnique || null;

      this.currentWorkout = null;
    }

    /**
     * Запуск режима выполнения тренировки
     */
    async start(workoutId) {
      if (!this.service) return;

      let workout = await this.service.getWorkoutById(workoutId);
      if (!workout) {
        throw new Error(`Тренировка с ID "${workoutId}" не найдена.`);
      }

      // Переводим статус в started, если была planned
      if (workout.status === 'planned') {
        workout = await this.service.startWorkout(workoutId);
      }

      this.currentWorkout = workout;
      await this.render();
    }

    /**
     * Отрисовка экрана тренировки
     */
    async render() {
      if (!this.container || !this.currentWorkout) return;

      const workout = this.currentWorkout;

      let totalExercises = 0;
      (workout.content || []).forEach(set => {
        if (Array.isArray(set.exercises)) {
          totalExercises += set.exercises.length;
        }
      });
      const setsCount = (workout.content || []).length;

      // Формирование сетов и упражнений
      let setsHtml = '';
      (workout.content || []).forEach((set, sIdx) => {
        let exercisesHtml = '';

        (set.exercises || []).forEach((ex, eIdx) => {
          const hasMedia = Boolean((ex.mediaUrl && ex.mediaUrl.trim()) || (ex.videoId && ex.videoId.trim()));
          
          exercisesHtml += `
            <div 
              class="runner-exercise-item ${hasMedia ? 'has-media' : 'no-media'}" 
              data-sidx="${sIdx}" 
              data-eidx="${eIdx}"
              ${hasMedia ? 'role="button" tabindex="0"' : ''}
            >
              <div class="ex-top">
                <span class="ex-name">${escapeHtml(ex.name)}</span>
              </div>
              <div class="ex-meta">
                <span class="meta-tag">${escapeHtml(ex.scheme || 'Рабочий темп')}</span>
              </div>
              ${ex.needVideo ? `
                <div class="video-record-callout">
                  <span class="video-record-icon">📹</span>
                  <span class="video-record-label">Снять видео</span>
                </div>
              ` : ''}
              ${ex.notes ? `<div class="ex-notes">${escapeHtml(ex.notes)}</div>` : ''}
            </div>
          `;
        });

        setsHtml += `
          <div class="runner-set-block">
            <div class="runner-set-header">
              <span class="runner-set-title">${escapeHtml(set.setTitle || 'Сет')}</span>
              <span class="circuit-badge">${escapeHtml(set.rounds || '')}</span>
            </div>
            <div class="runner-exercises-list">
              ${exercisesHtml}
            </div>
          </div>
        `;
      });

      this.container.innerHTML = `
        <div class="workout-runner-view">
          <!-- Верхняя панель навигации -->
          <div class="runner-top-bar">
            <button type="button" class="btn-back-nav" id="btn-runner-back">
              ← В личный кабинет
            </button>
            <span class="runner-status-chip">⚡ Тренировка в процессе</span>
          </div>

          <!-- Заголовок тренировки -->
          <div class="runner-header-card">
            <div class="runner-date-badge">Текущая тренировка</div>
            <h2 class="runner-title">${escapeHtml(workout.title)}</h2>
            <div class="runner-stats-line">
              <span>${setsCount} сета</span> • <span>${totalExercises} упражнений</span>
            </div>
          </div>

          <!-- Список сетов и упражнений -->
          <div class="runner-content-list">
            ${setsHtml}
          </div>

          <!-- Завершение тренировки -->
          <div class="runner-footer-actions">
            <button type="button" class="btn btn-success w-full btn-lg" id="btn-runner-complete">
              ✔ Завершить тренировку
            </button>
            <button type="button" class="btn btn-secondary w-full" id="btn-runner-back-bottom" style="margin-top: 10px;">
              ← В личный кабинет
            </button>
          </div>
        </div>
      `;

      // Привязка взаимодействия с упражнениями (наведение для десктопа, клик для моб.)
      this.container.querySelectorAll('.runner-exercise-item.has-media').forEach(item => {
        const sIdx = parseInt(item.getAttribute('data-sidx'), 10);
        const eIdx = parseInt(item.getAttribute('data-eidx'), 10);
        const ex = this.currentWorkout.content[sIdx].exercises[eIdx];

        let hoverTimer = null;

        // Наведение мыши (desktop hover)
        item.addEventListener('mouseenter', () => {
          hoverTimer = setTimeout(() => {
            if (typeof this.onOpenTechnique === 'function') {
              this.onOpenTechnique(ex, { trigger: 'hover' });
            }
          }, 250); // Небольшая задержка для исключения случайных рывков курсора
        });

        item.addEventListener('mouseleave', () => {
          if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
          }
          if (typeof this.onCloseTechnique === 'function') {
            this.onCloseTechnique({ trigger: 'hover' });
          }
        });

        // Нажатие (для мобильных устройств и клика мышью / клавиатуры)
        const openClickHandler = (e) => {
          if (hoverTimer) clearTimeout(hoverTimer);
          if (typeof this.onOpenTechnique === 'function') {
            this.onOpenTechnique(ex, { trigger: 'click' });
          }
        };

        item.addEventListener('click', openClickHandler);
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openClickHandler(e);
          }
        });
      });

      // Кнопка "Завершить тренировку"
      const btnComplete = this.container.querySelector('#btn-runner-complete');
      if (btnComplete) {
        btnComplete.addEventListener('click', async () => {
          if (!this.service || !this.currentWorkout) return;

          btnComplete.disabled = true;
          btnComplete.textContent = 'Сохранение...';

          const completed = await this.service.completeWorkout(this.currentWorkout.id);
          this.currentWorkout = completed;

          if (typeof this.onComplete === 'function') {
            this.onComplete(completed);
          }
        });
      }

      // Кнопки возврата в кабинет
      const backHandler = () => {
        if (typeof this.onBack === 'function') {
          this.onBack(this.currentWorkout);
        }
      };

      const btnTop = this.container.querySelector('#btn-runner-back');
      const btnBottom = this.container.querySelector('#btn-runner-back-bottom');
      if (btnTop) btnTop.addEventListener('click', backHandler);
      if (btnBottom) btnBottom.addEventListener('click', backHandler);
    }
  }

  return {
    WorkoutRunner
  };
}));
