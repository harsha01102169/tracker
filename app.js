/* ==========================================================================
   ZENITH STUDY TRACKER - MULTI-USER GATE-CSE SPACE (app.js)
   ========================================================================== */

// --- HARDCODED DB CREDENTIALS ---
// Once you provide your full API key, we will replace this placeholder.
const DB_URL = "https://vkmgswhbxkvrmtutbzzh.supabase.co";
const DB_KEY = "sb_publishable_lpyJzV08u_ou27lAuW9RNw_WEOIw3kd"; 

// --- STATE MANAGEMENT ---
let state = {
    currentDate: "",        // Active date for the user (YYYY-MM-DD)
    tasks: [],              // Array of study tasks
    reflections: {},        // Focus/mood entries keyed by YYYY-MM-DD
    streak: 0,              // Daily study streak
    lastCompletedDate: "",   // Last day a task was completed (YYYY-MM-DD)
    systemOffsetDays: 0     // Debug offset to simulate date changes
};

let currentUser = null;     // Logged in Supabase user
let supabaseClient = null;  // Supabase client instance

// GATE-CSE & General subjects categories list
const CATEGORIES = [
    "Engineering Mathematics",
    "Digital Logics",
    "Computer Organization and Architecture",
    "Programming DSA",
    "Compiler Design",
    "Operating Systems",
    "Databases",
    "Computer Networks",
    "Aptitude",
    "English",
    "Reasoning",
    "General Mathematics",
    "PYQs",
    "Other"
];

// Chart instances
let trendChartInstance = null;
let distChartInstance = null;

// --- UTILITIES ---
function getSystemDate(offsetDays = 0) {
    const d = new Date();
    if (offsetDays !== 0) {
        d.setDate(d.getDate() + offsetDays);
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return "";
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString('en-US', options);
}

function formatDateShort(dateStr) {
    if (!dateStr) return "";
    const options = { month: 'short', day: 'numeric' };
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString('en-US', options);
}

function generateId() {
    return 'task_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// Convert category string to safe CSS classname (e.g. "Programming DSA" -> "Programming-DSA")
function getCategoryClass(catStr) {
    return (catStr || "Other").replace(/[^a-zA-Z0-9]/g, "-");
}

// --- SCREEN SWITCHER ---
function showScreen(screenId) {
    document.getElementById("screen-db-setup").style.display = "none";
    document.getElementById("screen-auth").style.display = "none";
    document.getElementById("screen-main").style.display = "none";
    
    document.getElementById(screenId).style.display = "flex";
}

// --- DATABASE CONNECTION SETUP ---
function initSupabase() {
    let url = DB_URL;
    let key = DB_KEY;
    
    // If the credentials are not hardcoded or are placeholder values, fallback to localStorage setup
    if (!url || url.includes("xxxx") || key === "YOUR_SUPABASE_ANON_KEY" || !key) {
        url = localStorage.getItem("zenith_db_url");
        key = localStorage.getItem("zenith_db_key");
        
        if (!url || !key) {
            showScreen("screen-db-setup");
            return;
        }
        document.getElementById("db-config-reset-wrapper").style.display = "block";
    } else {
        // Hardcoded, no need to show database setup options
        document.getElementById("db-config-reset-wrapper").style.display = "none";
    }
    
    try {
        supabaseClient = supabase.createClient(url, key);
        setupAuthListener();
    } catch (e) {
        console.error("Failed to initialize Supabase client:", e);
        showScreen("screen-db-setup");
    }
}

// --- AUTHENTICATION LISTENERS ---
function setupAuthListener() {
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (session) {
            currentUser = session.user;
            document.getElementById("sidebar-user-email").innerText = currentUser.email;
            showScreen("screen-main");
            showLoadingState();
            await loadUserData();
        } else {
            currentUser = null;
            showScreen("screen-auth");
        }
    });
}

function showLoadingState() {
    const spinner = `
        <div class="empty-state">
            <i class="fa-solid fa-spinner fa-spin text-cyan"></i>
            <p>Syncing GATE cloud data...</p>
        </div>
    `;
    document.getElementById("dashboard-task-list").innerHTML = spinner;
    document.getElementById("tasks-today-list").innerHTML = spinner;
    document.getElementById("tasks-tomorrow-list").innerHTML = spinner;
    document.getElementById("history-timeline-container").innerHTML = spinner;
}

// --- DATABASE FETCH OPERATIONS ---
async function loadUserData() {
    if (!currentUser) return;
    
    try {
        // 1. Fetch User Stats
        let { data: stats, error: statsError } = await supabaseClient
            .from('user_stats')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();
            
        if (statsError && statsError.code === 'PGRST116') {
            // Row doesn't exist, create initial row
            const defaultDate = getSystemDate(0);
            const { data: newStats, error: createError } = await supabaseClient
                .from('user_stats')
                .insert([{
                    user_id: currentUser.id,
                    streak: 0,
                    last_completed_date: null,
                    current_date: defaultDate
                }])
                .select()
                .single();
                
            if (createError) throw createError;
            stats = newStats;
        } else if (statsError) {
            throw statsError;
        }
        
        state.streak = stats.streak || 0;
        state.lastCompletedDate = stats.last_completed_date || "";
        state.currentDate = stats.current_date || getSystemDate(0);
        
        // 2. Fetch Tasks
        const { data: tasks, error: tasksError } = await supabaseClient
            .from('tasks')
            .select('*')
            .eq('user_id', currentUser.id);
            
        if (tasksError) throw tasksError;
        state.tasks = tasks || [];
        
        // 3. Fetch Reflections
        const { data: reflections, error: refError } = await supabaseClient
            .from('reflections')
            .select('*')
            .eq('user_id', currentUser.id);
            
        if (refError) throw refError;
        
        state.reflections = {};
        if (reflections) {
            reflections.forEach(ref => {
                state.reflections[ref.date] = {
                    focusRating: ref.focus_rating,
                    mood: ref.mood,
                    notes: ref.notes
                };
            });
        }
        
        // Check for calendar date changes since last session
        const currentActual = getSystemDate(state.systemOffsetDays);
        if (state.currentDate < currentActual) {
            await handleMissedDays(currentActual);
        }
        
        renderAll();
    } catch (e) {
        console.error("Error loading user data:", e);
        showToast("Cloud sync failed. Check database logs.", "warning");
    }
}

// Missed days rollover catcher
async function handleMissedDays(targetDate) {
    let tempDate = state.currentDate;
    const updates = [];
    const reflectionInserts = [];
    
    while (tempDate < targetDate) {
        const tempTasks = state.tasks.filter(t => t.date === tempDate);
        const completedCount = tempTasks.filter(t => t.completed).length;
        
        if (tempTasks.length > 0 && completedCount === 0) {
            state.streak = 0;
        }
        
        if (!state.reflections[tempDate]) {
            state.reflections[tempDate] = {
                focusRating: 0,
                mood: "neutral",
                notes: "Auto-closed: Day rolled over without manual reflection."
            };
            reflectionInserts.push({
                user_id: currentUser.id,
                date: tempDate,
                focus_rating: 0,
                mood: "neutral",
                notes: "Auto-closed: Day rolled over without manual reflection."
            });
        }
        
        state.tasks.forEach(t => {
            if (t.date === tempDate && !t.completed) {
                t.date = addDays(tempDate, 1);
                updates.push(supabaseClient.from('tasks').update({ date: t.date }).eq('id', t.id));
            }
        });
        
        tempDate = addDays(tempDate, 1);
    }
    
    state.currentDate = targetDate;
    
    try {
        if (reflectionInserts.length > 0) {
            await supabaseClient.from('reflections').insert(reflectionInserts);
        }
        await Promise.all(updates);
        await supabaseClient.from('user_stats').update({
            streak: state.streak,
            current_date: state.currentDate
        }).eq('user_id', currentUser.id);
    } catch (e) {
        console.error("Failed to commit rollover updates:", e);
    }
}

// --- CLOUD CRUD OPERATIONS ---

// Add planned task
async function addTask(name, category, duration, target, timeSlot) {
    const targetDate = target === "tomorrow" ? addDays(state.currentDate, 1) : state.currentDate;
    const id = generateId();
    
    const newTask = {
        id: id,
        user_id: currentUser.id,
        name: name,
        category: category,
        duration: parseInt(duration),
        time_slot: timeSlot || null,
        date: targetDate,
        completed: false,
        completed_at: null,
        is_spontaneous: false
    };
    
    state.tasks.push(newTask);
    renderAll();
    
    const { error } = await supabaseClient.from('tasks').insert([newTask]);
    if (error) {
        showToast("Failed to sync task to database.", "warning");
        console.error(error);
        await loadUserData();
    } else {
        showToast("Task added to your schedule!");
    }
}

// Add spontaneous task
async function addSpontaneousTask(name, category, duration, timeSlot) {
    const id = generateId();
    const nowStr = new Date().toISOString();
    
    const newTask = {
        id: id,
        user_id: currentUser.id,
        name: name,
        category: category,
        duration: parseInt(duration),
        time_slot: timeSlot || null,
        date: state.currentDate,
        completed: true,
        completed_at: nowStr,
        is_spontaneous: true
    };
    
    state.tasks.push(newTask);
    state.lastCompletedDate = state.currentDate;
    renderAll();
    
    try {
        const tInsert = supabaseClient.from('tasks').insert([newTask]);
        const sUpdate = supabaseClient.from('user_stats').update({
            last_completed_date: state.currentDate
        }).eq('user_id', currentUser.id);
        
        const [tRes, sRes] = await Promise.all([tInsert, sUpdate]);
        if (tRes.error) throw tRes.error;
        if (sRes.error) throw sRes.error;
        
        showToast("Spontaneous log saved!");
    } catch (e) {
        showToast("Failed to save spontaneous task.", "warning");
        console.error(e);
        await loadUserData();
    }
}

// Delete task
async function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    renderAll();
    
    const { error } = await supabaseClient.from('tasks').delete().eq('id', id);
    if (error) {
        showToast("Delete synchronization failed.", "warning");
        console.error(error);
        await loadUserData();
    } else {
        showToast("Task deleted.");
    }
}

// Toggle task completion
async function toggleTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        task.completed_at = task.completed ? new Date().toISOString() : null;
        
        if (task.completed) {
            state.lastCompletedDate = state.currentDate;
        }
        
        renderAll();
        
        try {
            const tUpdate = supabaseClient.from('tasks').update({
                completed: task.completed,
                completed_at: task.completed_at
            }).eq('id', id);
            
            const sUpdate = supabaseClient.from('user_stats').update({
                last_completed_date: state.lastCompletedDate
            }).eq('user_id', currentUser.id);
            
            const [tRes, sRes] = await Promise.all([tUpdate, sUpdate]);
            if (tRes.error) throw tRes.error;
            if (sRes.error) throw sRes.error;
            
            showToast(task.completed ? "Task completed!" : "Task incomplete.");
        } catch (e) {
            showToast("Failed to toggle status on cloud.", "warning");
            console.error(e);
            await loadUserData();
        }
    }
}

// Finalize Day Reflection
async function finalizeDay(rating, mood, notes) {
    const today = state.currentDate;
    const tomorrow = addDays(today, 1);
    
    const todayTasks = state.tasks.filter(t => t.date === today);
    const completedCount = todayTasks.filter(t => t.completed).length;
    const didStudy = completedCount > 0;
    
    if (didStudy) {
        const yesterday = addDays(today, -1);
        if (state.lastCompletedDate === yesterday || state.streak === 0 || state.lastCompletedDate === today) {
            state.streak += 1;
        } else {
            state.streak = 1;
        }
        state.lastCompletedDate = today;
    } else {
        if (todayTasks.length > 0) {
            state.streak = 0;
        }
    }
    
    state.reflections[today] = {
        focusRating: parseInt(rating),
        mood: mood,
        notes: notes
    };
    
    state.tasks.forEach(t => {
        if (t.date === today && !t.completed) {
            t.date = tomorrow;
        }
    });
    
    state.currentDate = tomorrow;
    renderAll();
    
    try {
        const rInsert = supabaseClient.from('reflections').insert([{
            user_id: currentUser.id,
            date: today,
            focus_rating: parseInt(rating),
            mood: mood,
            notes: notes
        }]);
        
        const tUpdates = supabaseClient.from('tasks').update({
            date: tomorrow
        }).eq('user_id', currentUser.id).eq('date', today).eq('completed', false);
        
        const sUpdate = supabaseClient.from('user_stats').update({
            streak: state.streak,
            last_completed_date: state.lastCompletedDate,
            current_date: tomorrow
        }).eq('user_id', currentUser.id);
        
        const [rRes, tRes, sRes] = await Promise.all([rInsert, tUpdates, sUpdate]);
        if (rRes.error) throw rRes.error;
        if (tRes.error) throw tRes.error;
        if (sRes.error) throw sRes.error;
        
        showToast("Day review finalized and synced!");
    } catch (e) {
        showToast("Failed to finalize day on server.", "warning");
        console.error(e);
        await loadUserData();
    }
}

// Simulate 1 day leap
async function debugSimulateNextDay() {
    state.systemOffsetDays += 1;
    const nextActual = getSystemDate(state.systemOffsetDays);
    
    const today = state.currentDate;
    const todayTasks = state.tasks.filter(t => t.date === today);
    const completedCount = todayTasks.filter(t => t.completed).length;
    
    if (todayTasks.length > 0 && completedCount === 0) {
        state.streak = 0;
    }
    
    if (!state.reflections[today]) {
        state.reflections[today] = {
            focusRating: 0,
            mood: "neutral",
            notes: "Simulated rollover: Day closed without manual reflection."
        };
        
        await supabaseClient.from('reflections').insert([{
            user_id: currentUser.id,
            date: today,
            focus_rating: 0,
            mood: "neutral",
            notes: "Simulated rollover: Day closed without manual reflection."
        }]);
    }
    
    state.tasks.forEach(t => {
        if (t.date === today && !t.completed) {
            t.date = nextActual;
        }
    });
    
    state.currentDate = nextActual;
    renderAll();
    
    try {
        const tUpdates = supabaseClient.from('tasks').update({
            date: nextActual
        }).eq('user_id', currentUser.id).eq('date', today).eq('completed', false);
        
        const sUpdate = supabaseClient.from('user_stats').update({
            streak: state.streak,
            current_date: nextActual
        }).eq('user_id', currentUser.id);
        
        await Promise.all([tUpdates, sUpdate]);
        showToast("Time machine jumped 24 hours!");
    } catch (e) {
        showToast("Simulate day failed to sync.", "warning");
        console.error(e);
        await loadUserData();
    }
}

// --- STATS CALCULATIONS ---
function calculateConsistencyScore(days = 7) {
    const today = state.currentDate;
    let totalScheduled = 0;
    let totalCompleted = 0;
    
    for (let i = 1; i <= days; i++) {
        const dStr = addDays(today, -i);
        const dayTasks = state.tasks.filter(t => t.date === dStr);
        totalScheduled += dayTasks.length;
        totalCompleted += dayTasks.filter(t => t.completed).length;
    }
    
    if (totalScheduled === 0) {
        let activeDays = 0;
        for (let i = 1; i <= days; i++) {
            const dStr = addDays(today, -i);
            if (state.reflections[dStr] && state.reflections[dStr].focusRating > 0) {
                activeDays++;
            }
        }
        return Math.round((activeDays / days) * 100);
    }
    
    return Math.round((totalCompleted / totalScheduled) * 100);
}

function calculateHoursStudied(dateStr) {
    const dayTasks = state.tasks.filter(t => t.date === dateStr && t.completed);
    const totalMinutes = dayTasks.reduce((sum, t) => sum + t.duration, 0);
    return (totalMinutes / 60).toFixed(1);
}

// --- RENDER ENGINE ---
function renderAll() {
    renderSidebar();
    renderStats();
    renderTasksTab();
    renderDashboardTasks();
    renderHeatmap();
    renderHistory();
    renderInsights();
    renderCharts();
}

function renderSidebar() {
    document.getElementById("sidebar-streak-count").innerText = state.streak;
    document.getElementById("sidebar-display-date").innerText = formatDateDisplay(state.currentDate);
    // Display today's date prominently in the header
    document.getElementById("dashboard-date-display").innerText = formatDateDisplay(state.currentDate);
}

function renderStats() {
    const today = state.currentDate;
    const todayTasks = state.tasks.filter(t => t.date === today);
    const completedTasks = todayTasks.filter(t => t.completed);
    
    const consistency = calculateConsistencyScore(7);
    document.getElementById("stat-consistency").innerText = `${consistency}%`;
    
    const hours = calculateHoursStudied(today);
    document.getElementById("stat-focus-hours").innerText = `${hours}h`;
    const totalMins = todayTasks.filter(t => t.completed).reduce((sum, t) => sum + t.duration, 0);
    document.getElementById("stat-focus-sub").innerText = `${totalMins} mins focus logged`;
    
    document.getElementById("stat-streak").innerText = `${state.streak} days`;
    document.getElementById("stat-streak-sub").innerText = state.streak > 0 ? "Fantastic! Keep it burning!" : "Study today to start a streak!";
    
    document.getElementById("stat-today-completion").innerText = `${completedTasks.length} / ${todayTasks.length}`;
    const pct = todayTasks.length > 0 ? (completedTasks.length / todayTasks.length) * 100 : 0;
    document.getElementById("stat-today-progress-bar").style.width = `${pct}%`;
}

function renderDashboardTasks() {
    const container = document.getElementById("dashboard-task-list");
    const today = state.currentDate;
    const todayTasks = state.tasks.filter(t => t.date === today);
    
    if (todayTasks.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-square-check"></i>
                <p>No study tasks planned for today. Add a planned task or log a spontaneous study session to get started!</p>
            </div>
        `;
        return;
    }
    
    let html = "";
    todayTasks.forEach(task => {
        const catClass = getCategoryClass(task.category);
        html += `
            <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
                <div class="task-left">
                    <div class="checkbox-custom" onclick="toggleTask('${task.id}')">
                        <i class="fa-solid fa-check"></i>
                    </div>
                    <div class="task-details">
                        <span class="task-title">${task.name}</span>
                        <div class="task-meta">
                            <span class="category-dot category-${catClass}"></span>
                            <span>${task.category}</span>
                            ${task.time_slot ? `<span>•</span> <span class="badge badge-time"><i class="fa-regular fa-clock"></i> ${task.time_slot}</span>` : ''}
                            <span>•</span>
                            <span>${task.duration} mins</span>
                            ${task.is_spontaneous ? '<span>•</span> <span class="badge badge-success btn-sm" style="font-size:0.55rem; padding: 1px 4px;">Spontaneous</span>' : ''}
                        </div>
                    </div>
                </div>
                <div class="task-actions">
                    <button class="btn-delete-task" onclick="deleteTask('${task.id}')">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function renderTasksTab() {
    const todayList = document.getElementById("tasks-today-list");
    const tomorrowList = document.getElementById("tasks-tomorrow-list");
    
    const today = state.currentDate;
    const tomorrow = addDays(today, 1);
    
    const todayTasks = state.tasks.filter(t => t.date === today);
    const tomorrowTasks = state.tasks.filter(t => t.date === tomorrow);
    
    document.getElementById("tasks-today-badge").innerText = `${todayTasks.length} tasks`;
    document.getElementById("tasks-tomorrow-badge").innerText = `${tomorrowTasks.length} tasks`;
    
    // Today list
    if (todayTasks.length === 0) {
        todayList.innerHTML = `
            <div class="empty-state" style="padding: 1.5rem 1rem;">
                <i class="fa-solid fa-list-check" style="font-size: 1.8rem;"></i>
                <p style="font-size: 0.8rem;">No tasks scheduled for today.</p>
            </div>
        `;
    } else {
        let html = "";
        todayTasks.forEach(task => {
            const catClass = getCategoryClass(task.category);
            html += `
                <div class="task-item ${task.completed ? 'completed' : ''}">
                    <div class="task-left">
                        <div class="checkbox-custom" onclick="toggleTask('${task.id}')">
                            <i class="fa-solid fa-check"></i>
                        </div>
                        <div class="task-details">
                            <span class="task-title">${task.name}</span>
                            <div class="task-meta">
                                <span class="category-dot category-${catClass}"></span>
                                <span>${task.category}</span>
                                ${task.time_slot ? `<span>•</span> <span class="badge badge-time" style="padding: 2px 6px;"><i class="fa-regular fa-clock"></i> ${task.time_slot}</span>` : ''}
                                <span>•</span>
                                <span>${task.duration}m</span>
                            </div>
                        </div>
                    </div>
                    <div class="task-actions">
                        <button class="btn-delete-task" onclick="deleteTask('${task.id}')">
                            <i class="fa-regular fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        todayList.innerHTML = html;
    }
    
    // Tomorrow list
    if (tomorrowTasks.length === 0) {
        tomorrowList.innerHTML = `
            <div class="empty-state" style="padding: 1.5rem 1rem;">
                <i class="fa-solid fa-moon" style="font-size: 1.8rem;"></i>
                <p style="font-size: 0.8rem;">No pre-planned tasks for tomorrow.</p>
            </div>
        `;
    } else {
        let html = "";
        tomorrowTasks.forEach(task => {
            const catClass = getCategoryClass(task.category);
            html += `
                <div class="task-item">
                    <div class="task-left">
                        <div class="checkbox-custom" style="opacity: 0.5; pointer-events: none;">
                            <i class="fa-solid fa-check"></i>
                        </div>
                        <div class="task-details">
                            <span class="task-title">${task.name}</span>
                            <div class="task-meta">
                                <span class="category-dot category-${catClass}"></span>
                                <span>${task.category}</span>
                                ${task.time_slot ? `<span>•</span> <span class="badge badge-time" style="padding: 2px 6px;"><i class="fa-regular fa-clock"></i> ${task.time_slot}</span>` : ''}
                                <span>•</span>
                                <span>${task.duration}m</span>
                            </div>
                        </div>
                    </div>
                    <div class="task-actions">
                        <button class="btn-delete-task" onclick="deleteTask('${task.id}')">
                            <i class="fa-regular fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        tomorrowList.innerHTML = html;
    }
}

function renderHeatmap() {
    const container = document.getElementById("heatmap-grid-container");
    container.innerHTML = "";
    
    const today = state.currentDate;
    if (!today) return;
    
    const totalDays = 133;
    const cells = [];
    
    for (let i = totalDays - 1; i >= 0; i--) {
        cells.push(addDays(today, -i));
    }
    
    let html = "";
    cells.forEach(dateStr => {
        const dayTasks = state.tasks.filter(t => t.date === dateStr && t.completed);
        const totalDuration = dayTasks.reduce((sum, t) => sum + t.duration, 0);
        const completedCount = dayTasks.length;
        
        let level = 0;
        if (totalDuration > 0 && totalDuration <= 45) level = 1;
        else if (totalDuration > 45 && totalDuration <= 90) level = 2;
        else if (totalDuration > 90 && totalDuration <= 180) level = 3;
        else if (totalDuration > 180) level = 4;
        
        const tooltip = `${formatDateDisplay(dateStr)}: ${completedCount} task(s) completed (${totalDuration} mins)`;
        html += `<div class="heatmap-cell level-${level}" data-date="${dateStr}" data-tooltip="${tooltip}"></div>`;
    });
    
    container.innerHTML = html;
}

function renderHistory() {
    const container = document.getElementById("history-timeline-container");
    const categoryFilter = document.getElementById("history-filter-category").value;
    
    const reflectionDates = Object.keys(state.reflections);
    const taskDates = [...new Set(state.tasks.map(t => t.date))];
    const allDates = [...new Set([...reflectionDates, ...taskDates])].sort().reverse();
    
    const historicalDates = allDates.filter(dStr => dStr < state.currentDate);
    
    if (historicalDates.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-book-open"></i>
                <p>No completed days logged yet. Keep studying, and your reflection history will be logged here!</p>
            </div>
        `;
        return;
    }
    
    let html = "";
    historicalDates.forEach(dateStr => {
        const reflection = state.reflections[dateStr] || { focusRating: 0, mood: "neutral", notes: "" };
        let dayTasks = state.tasks.filter(t => t.date === dateStr);
        
        if (categoryFilter !== "all") {
            dayTasks = dayTasks.filter(t => t.category === categoryFilter);
            if (dayTasks.length === 0) return;
        }
        
        const completedCount = dayTasks.filter(t => t.completed).length;
        const totalDuration = dayTasks.filter(t => t.completed).reduce((sum, t) => sum + t.duration, 0);
        const completionRate = dayTasks.length > 0 ? Math.round((completedCount / dayTasks.length) * 100) : 0;
        const statusClass = completionRate === 100 ? "completed-full" : (completedCount > 0 ? "completed-partial" : "");
        
        const moodEmojis = { great: "😆", good: "🙂", neutral: "😐", tired: "🥱", stressed: "🤯" };
        
        let starsHtml = "";
        for (let i = 1; i <= 5; i++) {
            starsHtml += i <= reflection.focusRating 
                ? '<i class="fa-solid fa-star text-warning"></i>' 
                : '<i class="fa-regular fa-star text-dark"></i>';
        }
        
        html += `
            <div class="timeline-day-block ${statusClass}">
                <div class="timeline-dot"></div>
                <div class="timeline-card">
                    <div class="timeline-header">
                        <div class="timeline-title-area">
                            <h4>${formatDateDisplay(dateStr)}</h4>
                            <div class="timeline-meta-badges">
                                <span class="badge ${completionRate === 100 ? 'badge-success' : 'badge-info'}">
                                    ${completedCount}/${dayTasks.length} Completed (${completionRate}%)
                                </span>
                                <span>•</span>
                                <span><i class="fa-regular fa-clock text-cyan"></i> ${totalDuration} mins</span>
                            </div>
                        </div>
                        <div class="timeline-ratings">
                            ${reflection.focusRating > 0 ? `<div class="timeline-rating-val">${starsHtml}</div>` : ''}
                            <span class="timeline-mood-emoji">${moodEmojis[reflection.mood] || "😐"}</span>
                        </div>
                    </div>
                    <div class="timeline-body">
                        ${reflection.notes ? `<p class="timeline-notes">"${reflection.notes}"</p>` : ''}
                        
                        ${dayTasks.length > 0 ? `
                            <div class="timeline-tasks-list">
                                <span class="timeline-tasks-title">Tasks Logged:</span>
                                ${dayTasks.map(t => {
                                    const catClass = getCategoryClass(t.category);
                                    return `
                                        <div class="timeline-task-item">
                                            <div class="timeline-task-left">
                                                <i class="fa-solid ${t.completed ? 'fa-circle-check text-green' : 'fa-circle text-dark'}"></i>
                                                <span class="timeline-task-name ${t.completed ? 'line-through' : ''}">${t.name}</span>
                                            </div>
                                            <span class="timeline-task-tag">${t.category} ${t.time_slot ? `(${t.time_slot})` : ''} (${t.duration}m)</span>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        ` : '<span class="timeline-tasks-title" style="color:var(--text-dark)">No scheduled tasks logged.</span>'}
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html || `
        <div class="empty-state">
            <i class="fa-solid fa-filter"></i>
            <p>No logged days match the selected subject filter.</p>
        </div>
    `;
}

function renderInsights() {
    const container = document.getElementById("analytics-insights");
    const reflectionDates = Object.keys(state.reflections).filter(d => state.reflections[d].focusRating > 0);
    
    if (reflectionDates.length < 2) {
        container.innerHTML = `
            <div class="insight-item">
                <div class="insight-icon icon-cyan">
                    <i class="fa-solid fa-brain"></i>
                </div>
                <div class="insight-text">
                    <h4>Analyze Focus and Consistency</h4>
                    <p>Keep using the app daily! Once you log at least 2 days of reflections, Zenith will automatically compile data on your focus trends, category distributions, and consistency boosts.</p>
                </div>
            </div>
        `;
        return;
    }
    
    const categoryTimes = {};
    CATEGORIES.forEach(c => categoryTimes[c] = 0);
    
    state.tasks.filter(t => t.completed).forEach(t => {
        categoryTimes[t.category] = (categoryTimes[t.category] || 0) + t.duration;
    });
    
    let favoriteCategory = "Math";
    let maxTime = 0;
    Object.keys(categoryTimes).forEach(c => {
        if (categoryTimes[c] > maxTime) {
            maxTime = categoryTimes[c];
            favoriteCategory = c;
        }
    });
    
    const focusSum = reflectionDates.reduce((sum, d) => sum + state.reflections[d].focusRating, 0);
    const avgFocus = (focusSum / reflectionDates.length).toFixed(1);
    
    const weekdayScores = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    reflectionDates.forEach(dStr => {
        const d = new Date(dStr + "T00:00:00");
        weekdayScores[d.getDay()].push(state.reflections[dStr].focusRating);
    });
    
    let bestDayIndex = -1;
    let maxAvgFocus = 0;
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    
    Object.keys(weekdayScores).forEach(dayIdx => {
        const scores = weekdayScores[dayIdx];
        if (scores.length > 0) {
            const avg = scores.reduce((s, val) => s + val, 0) / scores.length;
            if (avg > maxAvgFocus) {
                maxAvgFocus = avg;
                bestDayIndex = parseInt(dayIdx);
            }
        }
    });
    
    let html = "";
    if (maxTime > 0) {
        html += `
            <div class="insight-item">
                <div class="insight-icon icon-purple">
                    <i class="fa-solid fa-graduation-cap"></i>
                </div>
                <div class="insight-text">
                    <h4>Top Study Focus: ${favoriteCategory}</h4>
                    <p>You spent the most time studying <strong>${favoriteCategory}</strong>, totaling <strong>${(maxTime/60).toFixed(1)} hours</strong> of completed sessions. Excellent effort!</p>
                </div>
            </div>
        `;
    }
    
    let moodFocusTip = avgFocus >= 4.0 ? "Your average focus is exceptionally high!" 
                     : (avgFocus >= 3.0 ? "Your focus is solid, but there is room to reduce distractions." 
                                       : "Consider shorter pomodoro study chunks to prevent fatigue.");
    
    html += `
        <div class="insight-item">
            <div class="insight-icon icon-cyan">
                <i class="fa-solid fa-heart-pulse"></i>
            </div>
            <div class="insight-text">
                <h4>Average Focus Score: ${avgFocus} / 5.0 Stars</h4>
                <p>${moodFocusTip}</p>
            </div>
        </div>
    `;
    
    if (bestDayIndex !== -1) {
        html += `
            <div class="insight-item">
                <div class="insight-icon icon-orange">
                    <i class="fa-solid fa-calendar-check"></i>
                </div>
                <div class="insight-text">
                    <h4>Peak Study Day: ${dayNames[bestDayIndex]}s</h4>
                    <p>On average, your focus peaks on <strong>${dayNames[bestDayIndex]}s</strong> (averaging ${maxAvgFocus.toFixed(1)}/5 stars). Plan your most complex topics for this day!</p>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

function renderCharts() {
    const trendCtx = document.getElementById("trendChart")?.getContext("2d");
    const distCtx = document.getElementById("distributionChart")?.getContext("2d");
    if (!trendCtx || !distCtx) return;
    
    const today = state.currentDate;
    if (!today) return;
    
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        last7Days.push(addDays(today, -i));
    }
    
    const labels = last7Days.map(d => formatDateShort(d));
    const completionRates = last7Days.map(d => {
        const dayTasks = state.tasks.filter(t => t.date === d);
        if (dayTasks.length === 0) return 0;
        const comp = dayTasks.filter(t => t.completed).length;
        return Math.round((comp / dayTasks.length) * 100);
    });
    
    const focusRatings = last7Days.map(d => {
        const ref = state.reflections[d];
        return ref ? ref.focusRating * 20 : 0;
    });
    
    if (trendChartInstance) trendChartInstance.destroy();
    trendChartInstance = new Chart(trendCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Task Completion Rate (%)',
                    data: completionRates,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.15)',
                    fill: true,
                    tension: 0.35,
                    borderWidth: 3,
                    pointRadius: 4
                },
                {
                    label: 'Focus Score (scaled %)',
                    data: focusRatings,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.05)',
                    fill: false,
                    tension: 0.35,
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } } } },
            scales: {
                y: { min: 0, max: 100, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });
    
    // Build category totals, filter out empty elements to make legend look clean
    const categoryTotals = CATEGORIES.map(c => {
        const totalMins = state.tasks
            .filter(t => t.category === c && t.completed)
            .reduce((sum, t) => sum + t.duration, 0);
        return Math.round(totalMins);
    });
    
    if (distChartInstance) distChartInstance.destroy();
    
    // Dynamic colors
    const colors = [
        '#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#ec4899', 
        '#8b5cf6', '#06b6d4', '#14b8a6', '#eab308', '#84cc16', 
        '#a855f7', '#f43f5e', '#0ea5e9', '#64748b'
    ];
    
    const hasData = categoryTotals.some(val => val > 0);
    
    distChartInstance = new Chart(distCtx, {
        type: 'doughnut',
        data: {
            labels: hasData ? CATEGORIES : CATEGORIES.map(c => `${c} (No log)`),
            datasets: [{
                data: hasData ? categoryTotals : Array(CATEGORIES.length).fill(1),
                backgroundColor: colors.slice(0, CATEGORIES.length),
                borderWidth: 2,
                borderColor: '#0f1222'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'right', 
                    labels: { 
                        color: '#94a3b8', 
                        font: { family: 'Plus Jakarta Sans', size: 9 }, 
                        boxWidth: 8,
                        padding: 8
                    } 
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (!hasData) return "No studies logged";
                            const mins = context.raw;
                            return ` ${context.label}: ${(mins / 60).toFixed(1)} hrs (${mins} mins)`;
                        }
                    }
                }
            },
            cutout: '60%'
        }
    });
}

function showToast(message, type = "success") {
    const toast = document.getElementById("toast-container");
    toast.querySelector(".toast-message").innerText = message;
    const icon = toast.querySelector(".toast-icon");
    if (type === "success") {
        icon.className = "toast-icon fa-solid fa-circle-check text-green";
        toast.style.borderLeftColor = "var(--color-success)";
    } else {
        icon.className = "toast-icon fa-solid fa-triangle-exclamation text-orange";
        toast.style.borderLeftColor = "var(--color-orange)";
    }
    toast.classList.add("show");
    setTimeout(() => { toast.classList.remove("show"); }, 3000);
}

function toggleReflectionModal(show = true) {
    const modal = document.getElementById("modal-reflection");
    if (show) {
        const today = state.currentDate;
        const todayTasks = state.tasks.filter(t => t.date === today);
        const completedCount = todayTasks.filter(t => t.completed).length;
        const totalDuration = todayTasks.filter(t => t.completed).reduce((sum, t) => sum + t.duration, 0);
        
        document.getElementById("modal-summary-tasks").innerText = `${completedCount} / ${todayTasks.length}`;
        document.getElementById("modal-summary-hours").innerText = `${totalDuration} mins`;
        
        document.getElementById("reflection-rating-value").value = "0";
        document.querySelectorAll(".star-rating").forEach(s => s.classList.remove("active"));
        document.querySelectorAll(".star-rating i").forEach(i => {
            i.classList.remove("fa-solid");
            i.classList.add("fa-regular");
        });
        
        document.getElementById("reflection-mood-value").value = "";
        document.querySelectorAll(".mood-btn").forEach(b => b.classList.remove("active"));
        document.getElementById("reflection-notes").value = "";
        
        modal.classList.add("active");
    } else {
        modal.classList.remove("active");
    }
}

// --- EVENT HANDLERS & INITIALIZATION ---

document.addEventListener("DOMContentLoaded", () => {
    initSupabase();
    
    // Auth Tab Selectors
    document.getElementById("tab-btn-login").addEventListener("click", () => {
        document.getElementById("tab-btn-login").classList.add("active");
        document.getElementById("tab-btn-register").classList.remove("active");
        document.getElementById("form-login").style.display = "flex";
        document.getElementById("form-register").style.display = "none";
        document.getElementById("auth-subtitle").innerText = "Log in to sync your custom study space.";
    });
    
    document.getElementById("tab-btn-register").addEventListener("click", () => {
        document.getElementById("tab-btn-register").classList.add("active");
        document.getElementById("tab-btn-login").classList.remove("active");
        document.getElementById("form-register").style.display = "flex";
        document.getElementById("form-login").style.display = "none";
        document.getElementById("auth-subtitle").innerText = "Create an account for cloud backup.";
    });
    
    // Database credentials setup (Fallback)
    document.getElementById("form-db-setup").addEventListener("submit", (e) => {
        e.preventDefault();
        const url = document.getElementById("db-url").value.trim();
        const key = document.getElementById("db-key").value.trim();
        
        localStorage.setItem("zenith_db_url", url);
        localStorage.setItem("zenith_db_key", key);
        
        initSupabase();
        showToast("Connected to database configuration!");
    });
    
    // Reset Database Connection
    document.getElementById("btn-reset-db-config").addEventListener("click", () => {
        localStorage.removeItem("zenith_db_url");
        localStorage.removeItem("zenith_db_key");
        showScreen("screen-db-setup");
    });
    
    // Login Submission
    document.getElementById("form-login").addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;
        
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
            showToast("Invalid credentials: " + error.message, "warning");
        } else {
            showToast("Welcome back!");
        }
    });
    
    // Register Submission
    document.getElementById("form-register").addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("register-email").value.trim();
        const password = document.getElementById("register-password").value;
        
        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) {
            showToast("Registration failed: " + error.message, "warning");
        } else {
            showToast("Account created! You can now log in.");
            document.getElementById("tab-btn-login").click();
        }
    });
    
    // Logout Action
    document.getElementById("btn-logout").addEventListener("click", async () => {
        await supabaseClient.auth.signOut();
        showToast("Logged out successfully.");
    });
    
    // Dashboard Tab Selection
    document.querySelectorAll(".nav-item").forEach(button => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            
            button.classList.add("active");
            const tabName = button.dataset.tab;
            document.getElementById(`tab-${tabName}`).classList.add("active");
            
            const titles = {
                dashboard: ["Dashboard Overview", "Track your focus and consistency daily"],
                tasks: ["Tasks & Planning", "Plan tomorrow's work or check off active sessions"],
                analytics: ["Analytics Hub", "Deep dive into focus cycles and subject ratios"],
                history: ["History Log", "Review reflections and completed schedules"]
            };
            document.getElementById("current-page-title").innerText = titles[tabName][0];
            
            if (tabName === "analytics") {
                setTimeout(renderCharts, 100);
            }
        });
    });
    
    document.getElementById("btn-quick-task-tab").addEventListener("click", () => {
        document.getElementById("btn-tab-tasks").click();
    });
    
    // Spontaneous task logger
    document.getElementById("form-spontaneous-task").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("spontaneous-task-name").value;
        const category = document.getElementById("spontaneous-task-category").value;
        const timeSlot = document.getElementById("spontaneous-task-slot").value;
        const duration = document.getElementById("spontaneous-task-duration").value;
        
        addSpontaneousTask(name, category, duration, timeSlot);
        document.getElementById("form-spontaneous-task").reset();
    });
    
    // Planned task scheduler
    document.getElementById("form-plan-task").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("plan-task-name").value;
        const category = document.getElementById("plan-task-category").value;
        const timeSlot = document.getElementById("plan-task-slot").value;
        const duration = document.getElementById("plan-task-duration").value;
        const target = document.querySelector('input[name="plan-task-target"]:checked').value;
        
        addTask(name, category, duration, target, timeSlot);
        
        // Reset name, slot, duration
        document.getElementById("plan-task-name").value = "";
        document.getElementById("plan-task-slot").value = "";
        document.getElementById("plan-task-duration").value = "";
    });
    
    // Rollover modal controls
    document.getElementById("btn-trigger-rollover").addEventListener("click", () => {
        toggleReflectionModal(true);
    });
    
    document.getElementById("btn-close-reflection").addEventListener("click", () => {
        toggleReflectionModal(false);
    });
    
    // Star rating select
    document.querySelectorAll(".star-rating").forEach(star => {
        star.addEventListener("click", () => {
            const rating = parseInt(star.dataset.rating);
            document.getElementById("reflection-rating-value").value = rating;
            
            document.querySelectorAll(".star-rating").forEach(s => {
                const sVal = parseInt(s.dataset.rating);
                const icon = s.querySelector("i");
                if (sVal <= rating) {
                    s.classList.add("active");
                    icon.classList.remove("fa-regular");
                    icon.classList.add("fa-solid");
                } else {
                    s.classList.remove("active");
                    icon.classList.remove("fa-solid");
                    icon.classList.add("fa-regular");
                }
            });
        });
    });
    
    // Mood select buttons
    document.querySelectorAll(".mood-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".mood-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById("reflection-mood-value").value = btn.dataset.mood;
        });
    });
    
    // Reflection submission
    document.getElementById("form-reflection").addEventListener("submit", (e) => {
        e.preventDefault();
        const rating = document.getElementById("reflection-rating-value").value;
        const mood = document.getElementById("reflection-mood-value").value;
        const notes = document.getElementById("reflection-notes").value;
        
        if (rating === "0") {
            showToast("Please rate today's focus!", "warning");
            return;
        }
        if (!mood) {
            showToast("Please select a study mood!", "warning");
            return;
        }
        
        finalizeDay(rating, mood, notes);
        toggleReflectionModal(false);
    });
    
    // History filter change
    document.getElementById("history-filter-category").addEventListener("change", () => {
        renderHistory();
    });
    
    // Time-travel simulated next day
    document.getElementById("btn-debug-tomorrow").addEventListener("click", () => {
        debugSimulateNextDay();
    });
    
    window.toggleTask = toggleTask;
    window.deleteTask = deleteTask;
});
