/**
 * WorkoutService & Storage Architecture
 * Модуль управления данными тренировок.
 * 
 * Абстрагирует источник данных (localStorage, Server API, Database),
 * предоставляя единый асинхронный интерфейс для UI.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WorkoutServiceModule = factory();
    root.WorkoutService = root.WorkoutServiceModule.WorkoutService;
    root.WorkoutStatus = root.WorkoutServiceModule.WorkoutStatus;
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Допустимые статусы тренировки
   */
  const WorkoutStatus = Object.freeze({
    PLANNED: 'planned',     // Запланирована
    STARTED: 'started',     // Начата
    COMPLETED: 'completed'  // Завершена
  });

  /**
   * Адаптер локального хранилища (localStorage + in-memory fallback)
   */
  class LocalStorageAdapter {
    constructor(storageKey = 'gym_workouts_store_v1') {
      this.storageKey = storageKey;
      this._memoryFallback = {};
      this._isLocalStorageAvailable = this._checkLocalStorage();
    }

    _checkLocalStorage() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const testKey = '__test_storage__';
          window.localStorage.setItem(testKey, '1');
          window.localStorage.removeItem(testKey);
          return true;
        }
      } catch (e) {
        // Заблокировано или недоступно
      }
      return false;
    }

    async _readAll() {
      if (this._isLocalStorageAvailable) {
        const raw = window.localStorage.getItem(this.storageKey);
        try {
          return raw ? JSON.parse(raw) : {};
        } catch (e) {
          console.error('[LocalStorageAdapter] Ошибка чтения JSON, сброс хранилища:', e);
          return {};
        }
      }
      return { ...this._memoryFallback };
    }

    async _writeAll(data) {
      if (this._isLocalStorageAvailable) {
        window.localStorage.setItem(this.storageKey, JSON.stringify(data));
      } else {
        this._memoryFallback = { ...data };
      }
      return true;
    }

    async getAll() {
      const all = await this._readAll();
      return Object.values(all);
    }

    async getById(id) {
      const all = await this._readAll();
      return all[id] || null;
    }

    async save(workout) {
      const all = await this._readAll();
      all[workout.id] = { ...workout };
      await this._writeAll(all);
      return { ...workout };
    }

    async update(id, partial) {
      const all = await this._readAll();
      if (!all[id]) {
        throw new Error(`Тренировка с ID "${id}" не найдена.`);
      }
      all[id] = {
        ...all[id],
        ...partial,
        id, // гарантируем неизменность id
        updatedAt: new Date().toISOString()
      };
      await this._writeAll(all);
      return { ...all[id] };
    }

    async delete(id) {
      const all = await this._readAll();
      if (all[id]) {
        delete all[id];
        await this._writeAll(all);
        return true;
      }
      return false;
    }

    async clear() {
      if (this._isLocalStorageAvailable) {
        window.localStorage.removeItem(this.storageKey);
      }
      this._memoryFallback = {};
      return true;
    }
  }

  /**
   * Сервис тренировок (бизнес-логика)
   */
  class WorkoutService {
    constructor(adapter = new LocalStorageAdapter()) {
      this.adapter = adapter;
    }

    /**
     * Позволяет заменить адаптер хранилища (например, на ServerApiAdapter)
     */
    setAdapter(newAdapter) {
      if (!newAdapter || typeof newAdapter.getAll !== 'function') {
        throw new Error('Некорректный адаптер хранилища.');
      }
      this.adapter = newAdapter;
    }

    /**
     * Валидация структуры тренировки
     */
    _validateWorkout(workout) {
      if (!workout.id || typeof workout.id !== 'string') {
        throw new Error('Поле "id" обязательно и должно быть строкой.');
      }
      if (!workout.title || typeof workout.title !== 'string') {
        throw new Error('Поле "title" обязательно и должно быть строкой.');
      }
      if (!workout.scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(workout.scheduledDate)) {
        throw new Error('Поле "scheduledDate" обязательно и должно быть в формате YYYY-MM-DD.');
      }
      if (!Object.values(WorkoutStatus).includes(workout.status)) {
        throw new Error(`Недопустимый статус: "${workout.status}". Допустимые: ${Object.values(WorkoutStatus).join(', ')}`);
      }
      if (!Array.isArray(workout.content)) {
        throw new Error('Поле "content" должно быть массивом сетов/блоков.');
      }
    }

    /**
     * Создать новую тренировку
     */
    async createWorkout(data) {
      const nowIso = new Date().toISOString();
      const workout = {
        id: data.id || `w_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        title: data.title,
        scheduledDate: data.scheduledDate,
        status: data.status || WorkoutStatus.PLANNED,
        startedAt: data.startedAt || null,
        completedAt: data.completedAt || null,
        content: data.content || [],
        createdAt: data.createdAt || nowIso,
        updatedAt: data.updatedAt || nowIso
      };

      this._validateWorkout(workout);
      return await this.adapter.save(workout);
    }

    /**
     * Получить тренировку по ID
     */
    async getWorkoutById(id) {
      return await this.adapter.getById(id);
    }

    /**
     * Получить все тренировки
     */
    async getAllWorkouts() {
      return await this.adapter.getAll();
    }

    /**
     * Получить единственную текущую активную тренировку для клиента.
     * Возвращает тренировку, которая еще не завершена (status !== 'completed').
     * Будущие тренировки клиенту не показываются до завершения текущей.
     */
    async getCurrentWorkout() {
      const all = await this.adapter.getAll();
      // Находим текущую незавершенную тренировку: сначала начатую (started)
      const started = all.find(w => w.status === WorkoutStatus.STARTED);
      if (started) return started;
      // Затем актуальную запланированную (planned)
      const planned = all.filter(w => w.status === WorkoutStatus.PLANNED);
      if (planned.length > 0) {
        // Возвращаем последнюю назначенную тренировку
        return planned[planned.length - 1];
      }
      return null;
    }

    /**
     * Получить завершенные тренировки (историю)
     */
    async getCompletedWorkouts() {
      const all = await this.adapter.getAll();
      return all
        .filter(w => w.status === WorkoutStatus.COMPLETED)
        .sort((a, b) => (b.completedAt || b.scheduledDate || '').localeCompare(a.completedAt || a.scheduledDate || ''));
    }

    /**
     * Начать выполнение тренировки (перевод в статус "Начата")
     */
    async startWorkout(id) {
      const workout = await this.getWorkoutById(id);
      if (!workout) {
        throw new Error(`Тренировка "${id}" не найдена.`);
      }

      const updateData = {
        status: WorkoutStatus.STARTED,
        startedAt: workout.startedAt || new Date().toISOString()
      };

      return await this.adapter.update(id, updateData);
    }

    /**
     * Завершить тренировку вручную (перевод в статус "Завершена")
     */
    async completeWorkout(id) {
      const workout = await this.getWorkoutById(id);
      if (!workout) {
        throw new Error(`Тренировка "${id}" не найдена.`);
      }

      // Сохраняем ID завершенной тренировки в постоянный список завершенных
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const raw = window.localStorage.getItem('gym_completed_workout_ids');
          const ids = raw ? JSON.parse(raw) : [];
          if (!ids.includes(id)) {
            ids.push(id);
            window.localStorage.setItem('gym_completed_workout_ids', JSON.stringify(ids));
          }
        }
      } catch (e) {}

      // Идемпотентность: если уже завершена, возвращаем без изменений
      if (workout.status === WorkoutStatus.COMPLETED) {
        return workout;
      }

      const updateData = {
        status: WorkoutStatus.COMPLETED,
        completedAt: workout.completedAt || new Date().toISOString(),
        autoCompleted: false
      };

      return await this.adapter.update(id, updateData);
    }

    /**
     * Обновить произвольные поля тренировки
     */
    async updateWorkout(id, patch) {
      return await this.adapter.update(id, patch);
    }

    /**
     * Удалить тренировку
     */
    async deleteWorkout(id) {
      return await this.adapter.delete(id);
    }

    /**
     * Первоначальное заполнение хранилища (Seeding).
     * Выполняется только один раз для каждой записи, если она ещё не существует.
     * Предотвращает дублирование при перезагрузках страницы.
     */
    async ensureSeeded() {
      // 1. Сначала применяем автозавершение просроченных тренировок по МСК
      await this.checkAndApplyAutoCompletion();

      let completedIds = [];
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const raw = window.localStorage.getItem('gym_completed_workout_ids');
          completedIds = raw ? JSON.parse(raw) : [];
        }
      } catch (e) {}

      let createdCount = 0;
      for (const item of SEED_WORKOUTS) {
        const isLocallyCompleted = completedIds.includes(item.id);
        const existing = await this.adapter.getById(item.id);
        if (!existing) {
          await this.createWorkout({
            ...item,
            status: isLocallyCompleted ? WorkoutStatus.COMPLETED : item.status,
            completedAt: isLocallyCompleted ? (item.completedAt || new Date().toISOString()) : item.completedAt,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          createdCount++;
        } else if (isLocallyCompleted && existing.status !== WorkoutStatus.COMPLETED) {
          await this.adapter.update(item.id, {
            status: WorkoutStatus.COMPLETED,
            completedAt: existing.completedAt || new Date().toISOString()
          });
        } else if (item.status === WorkoutStatus.COMPLETED && existing.status === WorkoutStatus.PLANNED && item.id === 'workout_2026_11_15') {
          // Обновляем архивную тренировку до завершенной, чтобы освободить очередь для новой активной тренировки
          await this.adapter.update(item.id, {
            status: WorkoutStatus.COMPLETED,
            completedAt: item.completedAt || '2026-11-15T16:00:00.000Z'
          });
        }
      }
      return { seededCount: createdCount };
    }

    /**
     * Проверка автозавершения: отключена по новой логике гибкого графика.
     * Тренировка ожидает выполнения и не завершается автоматически в 00:00.
     */
    async checkAndApplyAutoCompletion() {
      return { updatedCount: 0, disabled: true };
    }
  }

  /**
   * Получение текущей даты и времени по московскому часовому поясу (Europe/Moscow)
   */
  function getMoscowNow(customDate = null) {
    const d = customDate ? new Date(customDate) : new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(d);
    const getPart = (type) => parts.find(p => p.type === type).value;
    const y = getPart('year');
    const m = getPart('month');
    const day = getPart('day');
    const h = getPart('hour');
    const min = getPart('minute');
    const s = getPart('second');

    return {
      dateKey: `${y}-${m}-${day}`,
      isoString: `${y}-${m}-${day}T${h}:${min}:${s}+03:00`,
      year: parseInt(y, 10),
      month: parseInt(m, 10),
      day: parseInt(day, 10)
    };
  }

  /**
   * Исходная эталонная тренировка из index.html
   */
  const INITIAL_WORKOUT_2026_11_15 = Object.freeze({
    id: 'workout_2026_11_15',
    title: 'Тренировка дня (Индивидуальный план)',
    scheduledDate: '2026-11-15',
    status: WorkoutStatus.COMPLETED,
    startedAt: '2026-11-15T15:00:00.000Z',
    completedAt: '2026-11-15T16:00:00.000Z',
    content: [
      {
        setTitle: 'Разминочный сет',
        rounds: '2 круга',
        exercises: [
          {
            name: 'Жим 1 рукой вверх с кругом локтя',
            scheme: '4 кг • 10-15 раз',
            needVideo: false,
            notes: 'Движение плавное, контроль в верхней точке',
            mediaUrl: 'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif', // Пример: GIF-анимация
            videoId: ''
          },
          {
            name: 'Тяга 1 рукой в наклоне',
            scheme: 'Круг 1: 9 кг × 15 | Круг 2: 12 кг × 10',
            needVideo: true,
            notes: 'Снять на видео второй круг тяги',
            mediaUrl: '',
            videoId: 'dQw4w9WgXcQ' // Пример: YouTube ID
          }
        ]
      },
      {
        setTitle: 'Второй сет',
        rounds: '2 круга',
        exercises: [
          {
            name: 'Подъём ног в висе на двух руках (или с опорой локтями)',
            scheme: 'Рабочий темп',
            needVideo: false,
            notes: 'Контроль инерции и поясницы',
            mediaUrl: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600', // Пример: Фото/изображение
            videoId: ''
          },
          {
            name: 'Пуловер',
            scheme: '9 кг • 15-20 раз',
            needVideo: true,
            notes: 'Снять технику на видео',
            mediaUrl: '',
            videoId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' // Пример: полная ссылка на YouTube
          }
        ]
      },
      {
        setTitle: 'Третий сет',
        rounds: '2 круга',
        exercises: [
          {
            name: 'Зашагивание на возвышенность',
            scheme: 'Подконтрольный подъем',
            needVideo: false,
            notes: 'Без отталкивания опорной ногой',
            videoId: ''
          },
          {
            name: 'Наклоны в позиции шага на 1 ноге',
            scheme: 'Подконтрольный темп',
            needVideo: true,
            notes: 'Снять технику на видео',
            videoId: ''
          }
        ]
      },
      {
        setTitle: 'Четвёртый сет',
        rounds: '2-3 круга (по самочувствию/времени)',
        exercises: [
          {
            name: 'Ягодичный мостик с гантелью',
            scheme: '15 кг • 15-20 раз',
            needVideo: false,
            notes: 'Подложить коврик на таз и гантель сверху. Темп очень медленный.',
            videoId: ''
          }
        ]
      }
    ]
  });

  /**
   * Набор тестовых тренировок для Октября и Ноября 2026 года.
   * Все тренировки хранятся в едином формате и сохраняются в БД/хранилище.
   */
  const SEED_WORKOUTS = Object.freeze([
    // Октябрь 2026 (завершенные тренировки)
    {
      id: 'workout_2026_10_05',
      title: 'Сплит: Спина и бицепс',
      scheduledDate: '2026-10-05',
      status: WorkoutStatus.COMPLETED,
      startedAt: '2026-10-05T15:00:00.000Z',
      completedAt: '2026-10-05T15:55:00.000Z',
      content: [
        {
          setTitle: 'Основной сет',
          rounds: '3 круга',
          exercises: [
            { name: 'Тяга верхнего блока к груди', scheme: '35 кг • 12 раз', needVideo: false, notes: '', videoId: '' },
            { name: 'Подъем штанги на бицепс', scheme: '15 кг • 12-15 раз', needVideo: false, notes: '', videoId: '' }
          ]
        }
      ]
    },
    {
      id: 'workout_2026_10_12',
      title: 'Фулбоди: Выносливость',
      scheduledDate: '2026-10-12',
      status: WorkoutStatus.COMPLETED,
      startedAt: '2026-10-12T15:30:00.000Z',
      completedAt: '2026-10-12T16:20:00.000Z',
      content: [
        {
          setTitle: 'Круговой блок',
          rounds: '4 круга',
          exercises: [
            { name: 'Приседания с кубком', scheme: '12 кг • 15 раз', needVideo: false, notes: '', videoId: '' },
            { name: 'Отжимания от возвышенности', scheme: '12 раз', needVideo: false, notes: '', videoId: '' }
          ]
        }
      ]
    },
    {
      id: 'workout_2026_10_19',
      title: 'Низ тела: Ягодицы и кор',
      scheduledDate: '2026-10-19',
      status: WorkoutStatus.COMPLETED,
      startedAt: '2026-10-19T16:00:00.000Z',
      completedAt: '2026-10-19T16:50:00.000Z',
      content: [
        {
          setTitle: 'Силовой сет',
          rounds: '3 круга',
          exercises: [
            { name: 'Румынская тяга с гантелями', scheme: '10 кг × 2 • 12 раз', needVideo: true, notes: 'Спина прямая', videoId: '' },
            { name: 'Планка на предплечьях', scheme: '45 секунд', needVideo: false, notes: '', videoId: '' }
          ]
        }
      ]
    },
    {
      id: 'workout_2026_10_26',
      title: 'Верх тела: Плечи и грудь',
      scheduledDate: '2026-10-26',
      status: WorkoutStatus.COMPLETED,
      startedAt: '2026-10-26T15:10:00.000Z',
      completedAt: '2026-10-26T16:05:00.000Z',
      content: [
        {
          setTitle: 'Сет на плечи',
          rounds: '3 круга',
          exercises: [
            { name: 'Жим гантелей сидя', scheme: '6 кг × 2 • 12 раз', needVideo: false, notes: '', videoId: '' },
            { name: 'Махи гантелей через стороны', scheme: '3 кг × 2 • 15 раз', needVideo: false, notes: '', videoId: '' }
          ]
        }
      ]
    },
    // Ноябрь 2026 (прошлые завершенные)
    {
      id: 'workout_2026_11_03',
      title: 'Круговая тренировка на кор',
      scheduledDate: '2026-11-03',
      status: WorkoutStatus.COMPLETED,
      startedAt: '2026-11-03T16:00:00.000Z',
      completedAt: '2026-11-03T16:45:00.000Z',
      content: [
        {
          setTitle: 'Кор и стабилизация',
          rounds: '3 круга',
          exercises: [
            { name: 'Скручивания на фитболе', scheme: '20 раз', needVideo: false, notes: '', videoId: '' },
            { name: 'Боковая планка', scheme: 'по 30 сек на сторону', needVideo: false, notes: '', videoId: '' }
          ]
        }
      ]
    },
    {
      id: 'workout_2026_11_07',
      title: 'Сплит: Ноги и спина',
      scheduledDate: '2026-11-07',
      status: WorkoutStatus.COMPLETED,
      startedAt: '2026-11-07T14:30:00.000Z',
      completedAt: '2026-11-07T15:25:00.000Z',
      content: [
        {
          setTitle: 'Основной блок',
          rounds: '3 круга',
          exercises: [
            { name: 'Выпады назад с гантелями', scheme: '5 кг × 2 • 12 раз', needVideo: false, notes: '', videoId: '' },
            { name: 'Тяга гантели к поясу в упоре', scheme: '8 кг • 12 раз', needVideo: false, notes: '', videoId: '' }
          ]
        }
      ]
    },
    {
      id: 'workout_2026_11_11',
      title: 'Верх тела и пресс',
      scheduledDate: '2026-11-11',
      status: WorkoutStatus.COMPLETED,
      startedAt: '2026-11-11T16:15:00.000Z',
      completedAt: '2026-11-11T17:05:00.000Z',
      content: [
        {
          setTitle: 'Верхний сет',
          rounds: '3 круга',
          exercises: [
            { name: 'Отжимания от пола', scheme: '10-12 раз', needVideo: false, notes: '', videoId: '' },
            { name: 'Тяга горизонтального блока', scheme: '25 кг • 15 раз', needVideo: false, notes: '', videoId: '' }
          ]
        }
      ]
    },
    // 15 ноября 2026 — Прошлая завершенная тренировка
    INITIAL_WORKOUT_2026_11_15,
    // 16 ноября 2026 — ТЕКУЩАЯ АКТИВНАЯ ТРЕНИРОВКА ДАШИ ОТ ТРЕНЕРА
    {
      id: 'workout_client_dasha_seed_1794762375617_p8j0u',
      clientId: 'client_dasha_seed',
      title: 'Фулбоди: Спина и плечи (Тест 5.7)',
      scheduledDate: '2026-11-16',
      status: WorkoutStatus.PLANNED,
      startedAt: null,
      completedAt: null,
      content: [
        {
          setId: 'block_1',
          setTitle: 'Блок 1: Одиночное',
          rounds: '1 упражнение',
          exercises: [
            {
              id: 'ex_1',
              name: 'Жим гантелей стоя',
              scheme: '3 × 12 (16 кг)',
              notes: 'Держать пресс в напряжении',
              needVideo: true,
              mediaUrl: 'https://youtu.be/dQw4w9WgXcQ'
            }
          ]
        },
        {
          setId: 'block_2',
          setTitle: 'Суперсет A',
          rounds: '2 упражнения',
          exercises: [
            {
              id: 'ex_2_1',
              name: 'Подтягивания широким хватом',
              scheme: '3 × 10',
              notes: 'Лопатки вниз',
              needVideo: true,
              mediaUrl: ''
            },
            {
              id: 'ex_2_2',
              name: 'Отжимания на брусьях',
              scheme: '3 × 12 (10 кг)',
              notes: 'Корпус слегка вперед',
              needVideo: false,
              mediaUrl: ''
            }
          ]
        }
      ],
      createdAt: '2026-11-15T17:06:15.617Z'
    }
  ]);

  return {
    WorkoutStatus,
    INITIAL_WORKOUT_2026_11_15,
    SEED_WORKOUTS,
    LocalStorageAdapter,
    getMoscowNow,
    WorkoutService: new WorkoutService(), // Синглтон по умолчанию
    createWorkoutService: (adapter) => new WorkoutService(adapter)
  };
}));
