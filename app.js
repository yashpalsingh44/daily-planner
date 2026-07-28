document.addEventListener('DOMContentLoaded', () => {
    // Default Mock Tasks (Tailored for July 28, 2026, around 11:42 AM)
    const defaultTasks = [
        {
            id: 'task-1',
            title: 'Morning Meditation & Planning',
            desc: 'Start the day with mindfulness and list key objectives in the calendar.',
            date: '2026-07-28',
            start: '07:30',
            end: '08:00',
            status: 'completed',
            reminder: true,
            completedAt: '2026-07-28T08:02:11.000Z'
        },
        {
            id: 'task-2',
            title: 'Review Dashboard Prototypes',
            desc: 'Examine frontend layout designs, color harmony, gradients, and responsiveness rules.',
            date: '2026-07-28',
            start: '09:00',
            end: '11:00',
            status: 'completed',
            reminder: true,
            completedAt: '2026-07-28T10:58:45.000Z'
        },
        {
            id: 'task-3',
            title: 'AetherPlan Core Frontend Implementation',
            desc: 'Develop HTML structure, custom CSS glassmorphism, and interactive JavaScript features.',
            date: '2026-07-28',
            start: '11:00',
            end: '13:00',
            status: 'progress',
            reminder: true
        },
        {
            id: 'task-4',
            title: 'Lunch Break & Relax',
            desc: 'Healthy meal and a brief outdoor walk to recharge cognitive focus.',
            date: '2026-07-28',
            start: '13:00',
            end: '14:00',
            status: 'todo',
            reminder: true
        },
        {
            id: 'task-5',
            title: 'Git Repository & GitHub Push',
            desc: 'Initialize git locally, link to user\'s remote repository, and push files.',
            date: '2026-07-28',
            start: '14:30',
            end: '15:30',
            status: 'todo',
            reminder: false
        },
        {
            id: 'task-6',
            title: 'Client Progress Review Sync',
            desc: 'Gather user feedback on Phase 1 UI design and align on database schema details.',
            date: '2026-07-28',
            start: '16:00',
            end: '17:00',
            status: 'todo',
            reminder: true
        }
    ];

    // Get current date string in YYYY-MM-DD local format
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    // State Management
    let tasks = JSON.parse(localStorage.getItem('aetherplan_tasks')) || defaultTasks;
    let selectedDate = todayStr;
    let activeTab = 'dashboard';
    let remindersTriggered = JSON.parse(localStorage.getItem('aetherplan_triggered_reminders')) || [];

    // Migration/Ensure date exists
    tasks.forEach(t => {
        if (!t.date) t.date = todayStr;
    });

    // Elements Cache
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    const digitalClock = document.getElementById('digital-clock');
    const digitalDate = document.getElementById('digital-date');
    const greetingEl = document.getElementById('greeting');
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const currentViewDateInput = document.getElementById('current-view-date');
    
    // Modal Elements
    const taskModal = document.getElementById('task-modal');
    const openTaskModalBtn = document.getElementById('open-task-modal-btn');
    const closeTaskModalBtn = document.getElementById('close-task-modal-btn');
    const cancelTaskBtn = document.getElementById('cancel-task-btn');
    const taskForm = document.getElementById('task-form');
    
    // Toast Container
    const toastContainer = document.getElementById('toast-container');

    // Drag and Drop state
    let draggedTaskId = null;

    // Save tasks to LocalStorage
    function saveTasks() {
        localStorage.setItem('aetherplan_tasks', JSON.stringify(tasks));
        renderApp();
    }

    // Initialize Lucide Icons
    function updateIcons() {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    // Clock and Greeting function
    function updateClock() {
        const now = new Date();
        
        // Digital Clock Formatting
        let hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; // key '0' as '12'
        
        digitalClock.textContent = `${hours}:${minutes}:${seconds} ${ampm}`;
        
        // Digital Date Formatting
        const options = { weekday: 'long', month: 'long', day: 'numeric' };
        digitalDate.textContent = now.toLocaleDateString('en-US', options);

        // Greeting update
        const currentHour = now.getHours();
        if (currentHour < 12) {
            greetingEl.textContent = 'Good Morning!';
        } else if (currentHour < 18) {
            greetingEl.textContent = 'Good Afternoon!';
        } else {
            greetingEl.textContent = 'Good Evening!';
        }
    }

    // Theme Toggle Handler
    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        document.body.classList.toggle('dark-theme');
        const theme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
        localStorage.setItem('aetherplan_theme', theme);
    });

    // Load theme from preference (default to light)
    const savedTheme = localStorage.getItem('aetherplan_theme') || 'light';
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
    } else {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
    }

    // Initialize current view date listener
    if (currentViewDateInput) {
        currentViewDateInput.value = selectedDate;
        currentViewDateInput.addEventListener('change', (e) => {
            selectedDate = e.target.value;
            addTerminalLog(`AetherAgent: Switched active view to date ${selectedDate}.`);
            renderApp();
        });
    }

    // Navigation Handler
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = item.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    // Navigate to full timeline from Dashboard button
    document.querySelector('[data-action="go-to-timeline"]').addEventListener('click', () => {
        switchTab('timeline');
    });

    function switchTab(tabId) {
        activeTab = tabId;
        
        // Update nav UI
        navItems.forEach(nav => {
            if (nav.getAttribute('data-tab') === tabId) {
                nav.classList.add('active');
            } else {
                nav.classList.remove('active');
            }
        });

        // Update view display
        tabContents.forEach(content => {
            if (content.id === `tab-${tabId}`) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });

        renderApp();
    }

    // Toast Notification Maker
    function showToast(title, message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let iconName = 'info';
        if (type === 'success') iconName = 'check-circle';
        if (type === 'alert') iconName = 'bell';
        
        toast.innerHTML = `
            <div class="toast-icon">
                <i data-lucide="${iconName}"></i>
            </div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
        `;
        
        toastContainer.appendChild(toast);
        updateIcons();

        // Slide out and remove
        setTimeout(() => {
            toast.style.transform = 'translateX(120%)';
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 5000);
    }

    // Modals Control
    openTaskModalBtn.addEventListener('click', () => openModal());
    closeTaskModalBtn.addEventListener('click', closeModal);
    cancelTaskBtn.addEventListener('click', closeModal);
    
    // Close modal by clicking overlay
    taskModal.addEventListener('click', (e) => {
        if (e.target === taskModal) {
            closeModal();
        }
    });

    function openModal(taskToEdit = null) {
        taskModal.classList.add('active');
        if (taskToEdit) {
            document.getElementById('modal-title').textContent = 'Edit Plan Details';
            document.getElementById('task-id').value = taskToEdit.id;
            document.getElementById('task-title').value = taskToEdit.title;
            document.getElementById('task-desc').value = taskToEdit.desc;
            document.getElementById('task-date').value = taskToEdit.date || selectedDate;
            document.getElementById('task-start').value = taskToEdit.start;
            document.getElementById('task-end').value = taskToEdit.end;
            document.getElementById('task-reminder').checked = taskToEdit.reminder;
        } else {
            document.getElementById('modal-title').textContent = 'New Plan Configuration';
            taskForm.reset();
            document.getElementById('task-id').value = '';
            
            // Set current hour as default start time
            const now = new Date();
            const startHour = String(now.getHours()).padStart(2, '0');
            const startMin = String(now.getMinutes()).padStart(2, '0');
            const endHour = String((now.getHours() + 1) % 24).padStart(2, '0');
            
            document.getElementById('task-date').value = selectedDate;
            document.getElementById('task-start').value = `${startHour}:${startMin}`;
            document.getElementById('task-end').value = `${endHour}:${startMin}`;
            document.getElementById('task-reminder').checked = true;
        }
    }

    function closeModal() {
        taskModal.classList.remove('active');
        taskForm.reset();
    }

    // Form submission
    taskForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const taskId = document.getElementById('task-id').value;
        const title = document.getElementById('task-title').value;
        const desc = document.getElementById('task-desc').value;
        const date = document.getElementById('task-date').value;
        const start = document.getElementById('task-start').value;
        const end = document.getElementById('task-end').value;
        const reminder = document.getElementById('task-reminder').checked;

        // Validation
        if (start >= end) {
            showToast('Time Validation Error', 'End time must be later than start time.', 'alert');
            return;
        }

        if (taskId) {
            // Edit existing
            const index = tasks.findIndex(t => t.id === taskId);
            if (index !== -1) {
                const oldStatus = tasks[index].status;
                tasks[index] = {
                    ...tasks[index],
                    title, desc, date, start, end, reminder
                };
                
                showToast('Plan Updated', `"${title}" has been modified successfully.`, 'info');
            }
        } else {
            // Create new (defaults status to 'todo')
            const newTask = {
                id: 'task_' + Date.now(),
                title, desc, date, start, end,
                status: 'todo',
                reminder
            };
            tasks.push(newTask);
            showToast('Plan Scheduled', `"${title}" has been added to your schedule.`, 'success');
        }

        closeModal();
        saveTasks();
    });

    // Helper functions
    function timeToMinutes(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }

    function getFormattedTime(timeStr) {
        const [hStr, mStr] = timeStr.split(':');
        let h = parseInt(hStr);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12;
        return `${h}:${mStr} ${ampm}`;
    }

    // Reminder alert check loop
    function checkReminders() {
        const now = new Date();
        const currentHours = String(now.getHours()).padStart(2, '0');
        const currentMinutes = String(now.getMinutes()).padStart(2, '0');
        const currentTimeStr = `${currentHours}:${currentMinutes}`;
        
        tasks.forEach(task => {
            if (task.reminder && task.status !== 'completed') {
                // If it starts exactly now, or is upcoming in 10 minutes
                const taskStartMin = timeToMinutes(task.start);
                const currentMin = timeToMinutes(currentTimeStr);
                const difference = taskStartMin - currentMin;

                // 10 minutes warning reminder
                if (difference === 10) {
                    const reminderKey = `${task.id}_10m`;
                    if (!remindersTriggered.includes(reminderKey)) {
                        showToast('Upcoming Task Reminder', `"${task.title}" starts in 10 minutes (${getFormattedTime(task.start)}).`, 'alert');
                        remindersTriggered.push(reminderKey);
                        localStorage.setItem('aetherplan_triggered_reminders', JSON.stringify(remindersTriggered));
                    }
                }

                // Start alert
                if (difference === 0) {
                    const reminderKey = `${task.id}_start`;
                    if (!remindersTriggered.includes(reminderKey)) {
                        showToast('Task Starting Now!', `Time to start: "${task.title}".`, 'alert');
                        // Auto shift to progress status when start time hits
                        if (task.status === 'todo') {
                            task.status = 'progress';
                            saveTasks();
                        }
                        remindersTriggered.push(reminderKey);
                        localStorage.setItem('aetherplan_triggered_reminders', JSON.stringify(remindersTriggered));
                    }
                }
            }
        });
    }

    // Task Actions
    window.startTask = function(taskId) {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'progress';
            showToast('Task In Progress', `You are now working on "${task.title}".`, 'info');
            saveTasks();
        }
    };

    window.completeTask = function(taskId) {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'completed';
            task.completedAt = new Date().toISOString();
            showToast('Task Finished!', `Completed: "${task.title}". Saved to history.`, 'success');
            saveTasks();
        }
    };

    window.editTask = function(taskId) {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
            openModal(task);
        }
    };

    window.deleteTask = function(taskId) {
        const task = tasks.find(t => t.id === taskId);
        if (task && confirm(`Are you sure you want to remove "${task.title}"?`)) {
            tasks = tasks.filter(t => t.id !== taskId);
            showToast('Task Removed', 'The scheduled item was deleted.', 'info');
            saveTasks();
        }
    };

    window.reopenTask = function(taskId) {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'todo';
            delete task.completedAt;
            showToast('Task Re-opened', `Moved "${task.title}" back to planning.`, 'info');
            saveTasks();
        }
    };

    // DRAG AND DROP HANDLERS
    function setupDragAndDrop() {
        const draggableCards = document.querySelectorAll('.board-task-card');
        const dropzones = document.querySelectorAll('.board-dropzone');

        draggableCards.forEach(card => {
            card.addEventListener('dragstart', () => {
                draggedTaskId = card.getAttribute('data-task-id');
                card.style.opacity = '0.5';
            });

            card.addEventListener('dragend', () => {
                card.style.opacity = '1';
                draggedTaskId = null;
            });
        });

        dropzones.forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.style.background = 'rgba(255, 255, 255, 0.04)';
            });

            zone.addEventListener('dragleave', () => {
                zone.style.background = '';
            });

            zone.addEventListener('drop', () => {
                zone.style.background = '';
                if (draggedTaskId) {
                    const targetStatus = zone.id === 'list-todo' ? 'todo' : 'progress';
                    const task = tasks.find(t => t.id === draggedTaskId);
                    if (task && task.status !== targetStatus) {
                        task.status = targetStatus;
                        if (targetStatus === 'progress') {
                            showToast('Task In Progress', `Status updated: "${task.title}" is now active.`, 'info');
                        } else {
                            showToast('Task Re-scheduled', `Moved "${task.title}" back to To Do.`, 'info');
                        }
                        saveTasks();
                    }
                }
            });
        });
    }

    // MAIN RENDER APP PIPELINE
    function renderApp() {
        // Filter tasks for the selected date
        const dailyTasks = tasks.filter(t => t.date === selectedDate);

        // --- 1. STATS CALCULATION ---
        const total = dailyTasks.length;
        const todoCount = dailyTasks.filter(t => t.status === 'todo').length;
        const progressCount = dailyTasks.filter(t => t.status === 'progress').length;
        const completedCount = dailyTasks.filter(t => t.status === 'completed').length;
        const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

        // Render circular progress svg
        const circle = document.getElementById('progress-circle-svg');
        const radius = circle.r.baseVal.value;
        const circumference = radius * 2 * Math.PI;
        circle.style.strokeDasharray = `${circumference} ${circumference}`;
        const offset = circumference - (percent / 100) * circumference;
        circle.style.strokeDashoffset = offset;

        // Render counts on Dashboard
        document.getElementById('progress-percent-val').textContent = percent;
        document.getElementById('stat-todo-count').textContent = todoCount;
        document.getElementById('stat-progress-count').textContent = progressCount;
        document.getElementById('stat-completed-count').textContent = completedCount;

        // Render Board counts
        document.getElementById('count-todo').textContent = todoCount;
        document.getElementById('count-progress').textContent = progressCount;

        // --- 2. NOW DOING & NEXT UP RENDER ---
        const now = new Date();
        const currentHours = String(now.getHours()).padStart(2, '0');
        const currentMinutes = String(now.getMinutes()).padStart(2, '0');
        const currentTimeStr = `${currentHours}:${currentMinutes}`;
        const currentMin = timeToMinutes(currentTimeStr);

        // Find current activity: a task in progress OR active task within time range
        let ongoingTask = dailyTasks.find(t => t.status === 'progress');
        
        // If nothing explicitly marked in progress, check timelines
        if (!ongoingTask) {
            ongoingTask = dailyTasks.find(t => {
                const startM = timeToMinutes(t.start);
                const endM = timeToMinutes(t.end);
                return currentMin >= startM && currentMin <= endM && t.status !== 'completed';
            });
        }

        const currentDisplay = document.getElementById('current-task-display');
        const currentActive = document.getElementById('current-task-active');

        if (ongoingTask) {
            currentDisplay.classList.add('hidden');
            currentActive.classList.remove('hidden');
            
            currentActive.querySelector('.task-active-title').textContent = ongoingTask.title;
            currentActive.querySelector('.task-active-desc').textContent = ongoingTask.desc;
            document.getElementById('current-task-duration').textContent = `${getFormattedTime(ongoingTask.start)} - ${getFormattedTime(ongoingTask.end)}`;

            // Calculate progress bar relative to start & end time
            const startM = timeToMinutes(ongoingTask.start);
            const endM = timeToMinutes(ongoingTask.end);
            const duration = endM - startM;
            let currentOffset = currentMin - startM;
            
            if (currentOffset < 0) currentOffset = 0;
            if (currentOffset > duration) currentOffset = duration;
            
            const progressPercent = duration > 0 ? (currentOffset / duration) * 100 : 100;
            document.getElementById('current-task-progress').style.width = `${progressPercent}%`;

            const remainingMin = endM - currentMin;
            if (remainingMin > 0) {
                document.getElementById('current-task-remaining').textContent = `${remainingMin} mins remaining`;
            } else {
                document.getElementById('current-task-remaining').textContent = 'Deadline reached';
            }
        } else {
            currentDisplay.classList.remove('hidden');
            currentActive.classList.add('hidden');
        }

        // Find Next Up Plan: any plan starting in future, not completed, sort by start time
        const futurePlans = dailyTasks
            .filter(t => t.status !== 'completed' && t.id !== (ongoingTask ? ongoingTask.id : ''))
            .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
        
        const nextDisplay = document.getElementById('next-task-display');
        const nextActive = document.getElementById('next-task-active');

        if (futurePlans.length > 0) {
            const nextTask = futurePlans[0];
            nextDisplay.classList.add('hidden');
            nextActive.classList.remove('hidden');
            
            nextActive.querySelector('.task-active-title').textContent = nextTask.title;
            nextActive.querySelector('.task-active-desc').textContent = nextTask.desc;
            
            const nextStartMin = timeToMinutes(nextTask.start);
            const difference = nextStartMin - currentMin;
            
            if (difference > 0) {
                const diffHrs = Math.floor(difference / 60);
                const diffMins = difference % 60;
                let text = 'Starts in ';
                if (diffHrs > 0) text += `${diffHrs}h `;
                text += `${diffMins}m (${getFormattedTime(nextTask.start)})`;
                document.getElementById('next-task-time').textContent = text;
            } else {
                document.getElementById('next-task-time').textContent = `Scheduled at ${getFormattedTime(nextTask.start)}`;
            }
        } else {
            nextDisplay.classList.remove('hidden');
            nextActive.classList.add('hidden');
        }

        // --- 3. RENDERING MINI TIMELINE (DASHBOARD) ---
        const miniTimelineList = document.getElementById('mini-timeline-list');
        miniTimelineList.innerHTML = '';
        
        const sortedTodayTasks = [...dailyTasks].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
        
        if (sortedTodayTasks.length === 0) {
            miniTimelineList.innerHTML = `
                <div class="empty-state small">
                    <i data-lucide="calendar"></i>
                    <p>No tasks configured for today.</p>
                </div>
            `;
        } else {
            sortedTodayTasks.forEach(task => {
                const item = document.createElement('div');
                item.className = 'timeline-quick-item';
                
                let checkBtn = '';
                if (task.status !== 'completed') {
                    checkBtn = `
                        <button class="btn-icon success" onclick="completeTask('${task.id}')" title="Mark as Completed">
                            <i data-lucide="check"></i>
                        </button>
                    `;
                }

                item.innerHTML = `
                    <span class="quick-time">${getFormattedTime(task.start)}</span>
                    <span class="quick-line-indicator ${task.status}"></span>
                    <div class="quick-info">
                        <div class="quick-title">${task.title}</div>
                        <div class="quick-desc">${task.desc}</div>
                    </div>
                    <div class="quick-actions">
                        ${checkBtn}
                        <button class="btn-icon" onclick="editTask('${task.id}')" title="Edit Plan">
                            <i data-lucide="edit-3"></i>
                        </button>
                    </div>
                `;
                miniTimelineList.appendChild(item);
            });
        }

        // --- 4. RENDER REMINDERS PANEL ---
        const remindersContainer = document.getElementById('reminders-container');
        remindersContainer.innerHTML = '';
        const remindersTasks = dailyTasks.filter(t => t.reminder && t.status !== 'completed');

        if (remindersTasks.length === 0) {
            remindersContainer.innerHTML = `
                <div class="empty-state small">
                    <i data-lucide="bell-off"></i>
                    <p>No active reminders configured.</p>
                </div>
            `;
        } else {
            remindersTasks.forEach(task => {
                const rem = document.createElement('div');
                rem.className = 'reminder-item';
                rem.innerHTML = `
                    <i data-lucide="bell"></i>
                    <div class="reminder-text">
                        <h5>Alert set for ${getFormattedTime(task.start)}</h5>
                        <p>${task.title}</p>
                    </div>
                `;
                remindersContainer.appendChild(rem);
            });
        }

        // --- 5. RENDERING FULL TIMELINE VIEW ---
        const timelineGrid = document.getElementById('timeline-hours-grid');
        timelineGrid.innerHTML = '';

        // Generate 6:00 to 23:00 hours
        for (let hour = 6; hour <= 23; hour++) {
            const row = document.createElement('div');
            row.className = 'timeline-row';
            
            const hourStr = String(hour).padStart(2, '0') + ':00';
            const displayHour = getFormattedTime(hourStr);
            
            const hourCol = document.createElement('div');
            hourCol.className = 'timeline-hour-col';
            hourCol.textContent = displayHour;
            
            const tasksCol = document.createElement('div');
            tasksCol.className = 'timeline-tasks-col';
            
            // Find tasks that start inside this hour slot
            const hourTasks = dailyTasks.filter(t => {
                const taskStartHour = parseInt(t.start.split(':')[0]);
                return taskStartHour === hour;
            });

            if (hourTasks.length > 0) {
                hourTasks.forEach(task => {
                    const block = document.createElement('div');
                    block.className = `timeline-task-block ${task.status}`;
                    block.innerHTML = `
                        <div class="task-title-group">
                            <strong>${task.title}</strong>
                            <div class="task-meta">${getFormattedTime(task.start)} - ${getFormattedTime(task.end)}</div>
                        </div>
                        <div class="quick-actions">
                            <button class="btn-icon success" onclick="event.stopPropagation(); completeTask('${task.id}')" ${task.status === 'completed' ? 'style="display:none"' : ''} title="Complete">
                                <i data-lucide="check"></i>
                            </button>
                        </div>
                    `;
                    block.addEventListener('click', () => editTask(task.id));
                    tasksCol.appendChild(block);
                });
            } else {
                tasksCol.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem; font-style:italic;">No tasks scheduled</span>';
            }

            row.appendChild(hourCol);
            row.appendChild(tasksCol);
            timelineGrid.appendChild(row);
        }

        // --- 6. RENDER TASK BOARD columns ---
        const listTodo = document.getElementById('list-todo');
        const listProgress = document.getElementById('list-progress');

        listTodo.innerHTML = '';
        listProgress.innerHTML = '';

        const todoTasks = dailyTasks.filter(t => t.status === 'todo');
        const progressTasks = dailyTasks.filter(t => t.status === 'progress');

        if (todoTasks.length === 0) {
            listTodo.innerHTML = `
                <div class="empty-state small">
                    <i data-lucide="list-todo"></i>
                    <p>No tasks left to do!</p>
                </div>
            `;
        } else {
            todoTasks.forEach(task => {
                const card = document.createElement('div');
                card.className = 'board-task-card';
                card.draggable = true;
                card.setAttribute('data-task-id', task.id);
                card.innerHTML = `
                    <div class="board-task-header">
                        <span class="board-task-title">${task.title}</span>
                    </div>
                    <p class="board-task-desc">${task.desc}</p>
                    <div class="board-task-footer">
                        <span class="board-task-time">
                            <i data-lucide="clock"></i>
                            <span>${getFormattedTime(task.start)} - ${getFormattedTime(task.end)}</span>
                        </span>
                        <div class="board-task-actions">
                            <button class="btn-icon success" onclick="startTask('${task.id}')" title="Start Task">
                                <i data-lucide="play" style="width:12px;height:12px;fill:var(--text-secondary);"></i>
                            </button>
                            <button class="btn-icon" onclick="editTask('${task.id}')" title="Edit">
                                <i data-lucide="edit-3"></i>
                            </button>
                            <button class="btn-icon" onclick="deleteTask('${task.id}')" title="Delete">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </div>
                `;
                listTodo.appendChild(card);
            });
        }

        if (progressTasks.length === 0) {
            listProgress.innerHTML = `
                <div class="empty-state small">
                    <i data-lucide="play-circle"></i>
                    <p>Drag or start tasks here to show you are working on them!</p>
                </div>
            `;
        } else {
            progressTasks.forEach(task => {
                const card = document.createElement('div');
                card.className = 'board-task-card';
                card.draggable = true;
                card.setAttribute('data-task-id', task.id);
                card.innerHTML = `
                    <div class="board-task-header">
                        <span class="board-task-title">${task.title}</span>
                    </div>
                    <p class="board-task-desc">${task.desc}</p>
                    <div class="board-task-footer">
                        <span class="board-task-time">
                            <i data-lucide="clock"></i>
                            <span>${getFormattedTime(task.start)} - ${getFormattedTime(task.end)}</span>
                        </span>
                        <div class="board-task-actions">
                            <button class="btn-icon success" onclick="completeTask('${task.id}')" title="Complete Task">
                                <i data-lucide="check"></i>
                            </button>
                            <button class="btn-icon" onclick="editTask('${task.id}')" title="Edit">
                                <i data-lucide="edit-3"></i>
                            </button>
                            <button class="btn-icon" onclick="deleteTask('${task.id}')" title="Delete">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </div>
                `;
                listProgress.appendChild(card);
            });
        }

        // --- 7. RENDERING HISTORY TABLE ---
        const historyTableBody = document.getElementById('history-table-body');
        const historyEmpty = document.getElementById('history-empty');
        const searchTerm = document.getElementById('history-search').value.toLowerCase();
        
        historyTableBody.innerHTML = '';
        
        const completedTasks = tasks.filter(t => t.status === 'completed');
        const filteredCompleted = completedTasks.filter(t => 
            t.title.toLowerCase().includes(searchTerm) || 
            t.desc.toLowerCase().includes(searchTerm)
        );

        if (filteredCompleted.length === 0) {
            historyEmpty.classList.remove('hidden');
            document.querySelector('.history-table').style.display = 'none';
        } else {
            historyEmpty.classList.add('hidden');
            document.querySelector('.history-table').style.display = 'table';
            
            filteredCompleted.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).forEach(task => {
                const row = document.createElement('tr');
                const completedDate = new Date(task.completedAt);
                const displayCompletedTime = completedDate.toLocaleDateString('en-US') + ' ' + completedDate.toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'});
                
                row.innerHTML = `
                    <td><span class="table-title">${task.title}</span></td>
                    <td><div class="table-desc">${task.desc}</div></td>
                    <td>${getFormattedTime(task.start)} - ${getFormattedTime(task.end)}</td>
                    <td><span class="timestamp-badge">${displayCompletedTime}</span></td>
                    <td>
                        <div class="board-task-actions">
                            <button class="btn-icon" onclick="reopenTask('${task.id}')" title="Re-open Plan">
                                <i data-lucide="rotate-ccw"></i>
                            </button>
                            <button class="btn-icon" onclick="deleteTask('${task.id}')" title="Delete Permanent">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                `;
                historyTableBody.appendChild(row);
            });
        }

        // Re-bind Lucide Icons and drag listeners
        updateIcons();
        setupDragAndDrop();
        initTilt();
    }

    // Bind search keyup
    document.getElementById('history-search').addEventListener('input', () => {
        renderApp();
    });

    // --- AGENT CONSOLE LOGGER ---
    const terminalLogsContainer = document.getElementById('terminal-logs');
    const agentLogDb = [
        "AetherAgent: Scanning timeline tasks...",
        "AetherAgent: Real-time reminder checker active.",
        "AetherAgent: Checking notification permission status: OK.",
        "AetherAgent: Predicting task priority weights...",
        "AetherAgent: Caching data to local store...",
        "AetherAgent: Local storage validation: Stable.",
        "AetherAgent: Watching board state for drag activities...",
        "AetherAgent: Analysis index generated for today.",
        "AetherAgent: Evaluating daily performance percentage...",
        "AetherAgent: Standby mode active. Waiting for schedule updates..."
    ];

    function addTerminalLog(text) {
        if (!terminalLogsContainer) return;
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS
        const logLine = document.createElement('span');
        logLine.className = 'log-line';
        logLine.innerHTML = `<span style="color:var(--text-muted)">[${timeStr}]</span> ${text}`;
        
        terminalLogsContainer.appendChild(logLine);
        
        // Scroll to bottom
        terminalLogsContainer.scrollTop = terminalLogsContainer.scrollHeight;

        // Keep maximum 25 logs to prevent memory leaks
        while (terminalLogsContainer.children.length > 25) {
            terminalLogsContainer.removeChild(terminalLogsContainer.firstChild);
        }
    }

    // Initialize with boot logs
    function bootTerminal() {
        const bootSequence = [
            "AetherPlan Core Engine: Booting...",
            "AetherPlan: Mounting responsive styles...",
            "AetherAgent Subagent System: INITIALIZED.",
            "AetherAgent: Monitoring workspace directory: 'c:/laragon/www/daily planner'",
            "AetherAgent: Connected to client browser event loop.",
            "AetherAgent: Ready to set reminders."
        ];

        bootSequence.forEach((log, index) => {
            setTimeout(() => {
                addTerminalLog(log);
            }, index * 800);
        });

        // Start random periodic updates
        setInterval(() => {
            const randomIndex = Math.floor(Math.random() * agentLogDb.length);
            addTerminalLog(agentLogDb[randomIndex]);
        }, 12000);
    }

    // Start App Clock and trigger first renders
    updateClock();
    setInterval(updateClock, 1000);
    
    // Check reminders every 10 seconds
    checkReminders();
    setInterval(checkReminders, 10000);

    // --- 3D INTERACTIVE CARD TILT ---
    function initTilt() {
        const cards = document.querySelectorAll('.card, .board-task-card');
        cards.forEach(card => {
            if (card.getAttribute('data-tilt-active')) return;
            card.setAttribute('data-tilt-active', 'true');

            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const xc = rect.width / 2;
                const yc = rect.height / 2;
                const angleX = (yc - y) / 10; // max 10 degrees rotation
                const angleY = (x - xc) / 10;
                card.style.transform = `perspective(800px) rotateX(${angleX}deg) rotateY(${angleY}deg) translateY(-2px)`;
            });

            card.addEventListener('mouseleave', () => {
                card.style.transform = 'perspective(800px) rotateX(0) rotateY(0) translateY(0)';
            });
        });
    }

    // --- THREE.JS 3D PARTICLE BACKGROUND ---
    function initThreeBG() {
        const canvas = document.getElementById('three-bg-canvas');
        if (!canvas || !window.THREE) return;

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);

        const scene = new THREE.Scene();

        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.z = 30;

        // Custom Glowing Particle Texture
        function createParticleTexture() {
            const canvasTex = document.createElement('canvas');
            canvasTex.width = 16;
            canvasTex.height = 16;
            const ctx = canvasTex.getContext('2d');
            const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 16, 16);
            return new THREE.CanvasTexture(canvasTex);
        }

        // Generate Particles
        const particleCount = 200;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);

        const colorOptions = [
            new THREE.Color('#8b5cf6'), // Purple
            new THREE.Color('#38bdf8'), // Blue
            new THREE.Color('#10b981'), // Green
            new THREE.Color('#ec4899')  // Pink
        ];

        for (let i = 0; i < particleCount * 3; i += 3) {
            // Position
            positions[i] = (Math.random() - 0.5) * 80;     // x
            positions[i + 1] = (Math.random() - 0.5) * 80; // y
            positions[i + 2] = (Math.random() - 0.5) * 60; // z

            // Color
            const col = colorOptions[Math.floor(Math.random() * colorOptions.length)];
            colors[i] = col.r;
            colors[i + 1] = col.g;
            colors[i + 2] = col.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 1.5,
            sizeAttenuation: true,
            map: createParticleTexture(),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });

        const points = new THREE.Points(geometry, material);
        scene.add(points);

        // Interaction Mousemove
        let mouseX = 0;
        let mouseY = 0;
        document.addEventListener('mousemove', (e) => {
            mouseX = (e.clientX / window.innerWidth) - 0.5;
            mouseY = (e.clientY / window.innerHeight) - 0.5;
        });

        // Loop animation
        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);

            const elapsedTime = clock.getElapsedTime();

            // Rotate points gently
            points.rotation.y = elapsedTime * 0.05;
            points.rotation.x = elapsedTime * 0.03;

            // Parallax movement with mouse interpolation
            camera.position.x += (mouseX * 15 - camera.position.x) * 0.05;
            camera.position.y += (-mouseY * 15 - camera.position.y) * 0.05;
            camera.lookAt(scene.position);

            renderer.render(scene, camera);
        }

        animate();

        // Resize handler
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    // Initial render
    bootTerminal();
    initThreeBG();
    renderApp();
});
