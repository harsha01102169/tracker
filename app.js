/* ==========================================================================
   ZENITH STUDY TRACKER - MULTI-USER GATE-CSE SPACE (app.js)
   ========================================================================== */

// --- GLOBAL DEBUG LOGGING ---
window.onerror = function(message, source, lineno, colno, error) {
    alert("Runtime Error: " + message + "\nLine: " + lineno + "\nSource: " + source);
    return false;
};

window.onunhandledrejection = function(event) {
    alert("Promise Error: " + event.reason);
};

function logProgress(msg) {
    const container = document.getElementById("loading-progress");
    if (container) {
        const div = document.createElement("div");
        div.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }
    console.log("[Zenith Log] " + msg);
}

function promiseWithTimeout(promise, ms, timeoutError = "Operation timed out") {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutError)), ms))
    ]);
}

// --- HARDCODED DB CREDENTIALS ---
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
let isLoadingUserData = false; // Prevent concurrent data loading races

// GATE-CSE & General subjects categories list
const CATEGORIES = [
    "Engineering Mathematics",
    "Digital Logics",
    "Computer Organization and Architecture",
    "Programming DSA",
    "Theory of Computation",
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

function getCategoryClass(catStr) {
    return (catStr || "Other").replace(/[^a-zA-Z0-9]/g, "-");
}

function showScreen(screenId) {
    document.getElementById("screen-db-setup").style.display = "none";
    document.getElementById("screen-auth").style.display = "none";
    document.getElementById("screen-pending-approval").style.display = "none";
    document.getElementById("screen-main").style.display = "none";
    document.getElementById("screen-loading").style.display = "none";
    
    document.getElementById(screenId).style.display = "flex";
}

// --- DATABASE CONNECTION SETUP ---
function initSupabase() {
    logProgress("Initializing Supabase Client...");
    let url = DB_URL;
    let key = DB_KEY;
    
    if (!url || url.includes("xxxx") || key === "YOUR_SUPABASE_ANON_KEY" || !key) {
        logProgress("No credentials in file. Loading from LocalStorage...");
        url = localStorage.getItem("zenith_db_url");
        key = localStorage.getItem("zenith_db_key");
        
        if (!url || !key) {
            logProgress("No database credentials found. Directing to setup screen.");
            showScreen("screen-db-setup");
            return;
        }
        document.getElementById("db-config-reset-wrapper").style.display = "block";
    } else {
        document.getElementById("db-config-reset-wrapper").style.display = "none";
    }
    
    try {
        supabaseClient = supabase.createClient(url, key);
        logProgress("Supabase Client created successfully.");
        setupAuthListener();
    } catch (e) {
        logProgress("CRITICAL: Failed to init client: " + e.message);
        console.error("Failed to initialize Supabase client:", e);
        showScreen("screen-db-setup");
    }
}

// --- AUTHENTICATION LISTENERS ---
function setupAuthListener() {
    logProgress("Setting up auth state change listener...");
    supabaseClient.auth.onAuthStateChange((event, session) => {
        logProgress("Auth state changed event: " + event + " (Session: " + (session ? "Active" : "None") + ")");
        if (session) {
            currentUser = session.user;
            document.getElementById("sidebar-user-email").innerText = currentUser.email;
            
            // Only trigger data loading if the main dashboard is not already showing
            const mainVisible = document.getElementById("screen-main").style.display === "flex";
            if (!mainVisible || event === "SIGNED_IN") {
                showLoadingState();
                // Defer async database operations to a separate tick to avoid deadlocking the auth state machine
                setTimeout(async () => {
                    await loadUserData();
                }, 0);
            } else {
                logProgress("Dashboard already active. Bypassing redundant reload for event: " + event);
            }
        } else {
            currentUser = null;
            showScreen("screen-auth");
        }
    });
}

function showLoadingState() {
    logProgress("Showing loading screen overlay...");
    showScreen("screen-loading");
    const spinner = `
        <div class="empty-state">
            <i class="fa-solid fa-spinner fa-spin text-cyan"></i>
            <p>Syncing cloud data...</p>
        </div>
    `;
    document.getElementById("dashboard-task-list").innerHTML = spinner;
    document.getElementById("tasks-today-list").innerHTML = spinner;
    document.getElementById("tasks-tomorrow-list").innerHTML = spinner;
    document.getElementById("history-timeline-container").innerHTML = spinner;
}

// --- STREAK DYNAMIC CALCULATION ---
function calculateCurrentStreak() {
    const completedDates = [...new Set(
        state.tasks
            .filter(t => t.completed && t.date)
            .map(t => t.date)
    )].sort().reverse(); // Sort descending: latest dates first
    
    if (completedDates.length === 0) return 0;
    
    const today = state.currentDate;
    const yesterday = addDays(today, -1);
    
    // Streak is active only if they completed a task today or yesterday
    const latestDate = completedDates[0];
    if (latestDate !== today && latestDate !== yesterday) {
        return 0;
    }
    
    let streakCount = 1;
    let checkDate = latestDate;
    
    for (let i = 1; i < completedDates.length; i++) {
        const expectedPrevDate = addDays(checkDate, -1);
        if (completedDates[i] === expectedPrevDate) {
            streakCount++;
            checkDate = completedDates[i];
        } else {
            break; // Gap detected, stop counting
        }
    }
    
    return streakCount;
}

// --- DATABASE FETCH OPERATIONS ---
async function loadUserData() {
    if (!currentUser) return;
    if (isLoadingUserData) {
        logProgress("loadUserData() already in progress. Ignoring concurrent reload.");
        return;
    }
    isLoadingUserData = true;
    logProgress("Start loadUserData() for user: " + currentUser.email);
    
    try {
        logProgress("Step 1: Fetching user stats row...");
        let { data: statsArray, error: statsError } = await promiseWithTimeout(
            supabaseClient
                .from('user_stats')
                .select('*')
                .eq('user_id', currentUser.id),
            6000,
            "Database stats query timed out (6s)"
        );
            
        let stats = null;
        if (statsArray && statsArray.length > 0) {
            stats = statsArray[0];
        }
            
        if (statsError) {
            logProgress("Stats query returned error (Code: " + statsError.code + "): " + statsError.message);
        } else if (stats) {
            logProgress("Stats query succeeded. Streak: " + stats.streak + ", Approved: " + stats.approved);
        }
            
        if (!stats && !statsError) {
            logProgress("Stats row missing (empty list). Inserting default stats row...");
            const defaultDate = getSystemDate(0);
            const { data: newStatsArray, error: createError } = await promiseWithTimeout(
                supabaseClient
                    .from('user_stats')
                    .insert([{
                        user_id: currentUser.id,
                        streak: 0,
                        last_completed_date: null,
                        current_date: defaultDate,
                        approved: false // New users are unapproved by default
                    }])
                    .select(),
                6000,
                "Database stats insert timed out (6s)"
            );
                
            if (createError) {
                logProgress("Insert stats row failed: " + createError.message);
                throw createError;
            }
            stats = newStatsArray && newStatsArray.length > 0 ? newStatsArray[0] : null;
            logProgress("New stats row created. Approved: FALSE");
        } else if (statsError) {
            throw statsError;
        }
        
        if (!stats) {
            throw new Error("Failed to retrieve or create user stats row.");
        }
        
        // --- ADMIN APPROVAL CHECK ---
        const isApproved = stats.approved || false;
        logProgress("Verifying approval status: " + isApproved);
        if (!isApproved) {
            logProgress("User not approved. Redirecting to screen-pending-approval.");
            showScreen("screen-pending-approval");
            return;
        }
        
        logProgress("Approval granted. Accessing study space...");
        // Show main app screen if approved
        showScreen("screen-main");
        
        state.streak = stats.streak || 0;
        state.lastCompletedDate = stats.last_completed_date || "";
        state.currentDate = stats.current_date || getSystemDate(0);
        
        // --- DATE ALIGNMENT RESET SWITCH ---
        const currentActual = getSystemDate(0);
        if (state.currentDate > currentActual) {
            logProgress("System date is in the future. Resetting offset...");
            state.currentDate = currentActual;
            state.systemOffsetDays = 0;
            await promiseWithTimeout(
                supabaseClient.from('user_stats').update({
                    current_date: currentActual
                }).eq('user_id', currentUser.id),
                6000,
                "Database date update timed out (6s)"
            );
            showToast("Aligned study calendar back to today's actual date.");
        }
        
        logProgress("Step 2: Fetching tasks...");
        const { data: tasks, error: tasksError } = await promiseWithTimeout(
            supabaseClient
                .from('tasks')
                .select('*')
                .eq('user_id', currentUser.id),
            6000,
            "Database tasks query timed out (6s)"
        );
            
        if (tasksError) {
            logProgress("Tasks fetch error: " + tasksError.message);
            throw tasksError;
        }
        logProgress("Tasks fetched: " + (tasks ? tasks.length : 0));
        state.tasks = tasks || [];
        
        // --- STREAK AUTO-CORRECTION ---
        const calculatedStreak = calculateCurrentStreak();
        if (calculatedStreak !== state.streak) {
            logProgress("Streak mismatch! DB has: " + state.streak + ", calculated: " + calculatedStreak + ". Updating DB...");
            state.streak = calculatedStreak;
            // Sync the corrected streak to DB (non-blocking)
            supabaseClient.from('user_stats').update({
                streak: state.streak
            }).eq('user_id', currentUser.id).then(({ error }) => {
                if (error) console.error("Failed to sync corrected streak to DB:", error);
                else logProgress("Corrected streak synced successfully.");
            });
        }
        
        logProgress("Step 3: Fetching reflections...");
        const { data: reflections, error: refError } = await promiseWithTimeout(
            supabaseClient
                .from('reflections')
                .select('*')
                .eq('user_id', currentUser.id),
            6000,
            "Database reflections query timed out (6s)"
        );
            
        if (refError) {
            logProgress("Reflections fetch error: " + refError.message);
            throw refError;
        }
        logProgress("Reflections fetched: " + (reflections ? reflections.length : 0));
        
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
        
        logProgress("Checking for calendar date rollover...");
        const currentActualOffset = getSystemDate(state.systemOffsetDays);
        if (state.currentDate < currentActualOffset) {
            logProgress("Date rollover detected. Triggering handleMissedDays...");
            await handleMissedDays(currentActualOffset);
        }
        
        logProgress("Step 4: Rendering UI...");
        renderAll();
        logProgress("Data load and rendering complete!");
    } catch (e) {
        logProgress("CRITICAL EXCEPTION inside loadUserData(): " + e.message);
        console.error("Error loading user data:", e);
        showToast("Cloud sync failed. Check database logs.", "warning");
        try {
            logProgress("Logging out due to critical error...");
            await supabaseClient.auth.signOut();
        } catch (signOutErr) {
            console.error("Sign out failed:", signOutErr);
            showScreen("screen-auth");
        }
    } finally {
        isLoadingUserData = false;
    }
}

async function handleMissedDays(targetDate) {
    let tempDate = state.currentDate;
    const updates = [];
    const reflectionInserts = [];
    
    while (tempDate < targetDate) {
        const tempTasks = state.tasks.filter(t => t.date === tempDate);
        const completedCount = tempTasks.filter(t => t.completed).length;
        
        if (completedCount === 0) {
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
        state.streak = 0;
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
    
    if (completedCount === 0) {
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

// --- AUTOMATIC TIME SLOT DURATION DEDUCTION ---
function calculateDurationFromTimes(startTimeStr, endTimeStr) {
    if (!startTimeStr || !endTimeStr) return 0;
    
    const [startH, startM] = startTimeStr.split(':').map(Number);
    const [endH, endM] = endTimeStr.split(':').map(Number);
    
    let startMinutes = startH * 60 + startM;
    let endMinutes = endH * 60 + endM;
    
    if (endMinutes < startMinutes) {
        endMinutes += 24 * 60;
    }
    
    return endMinutes - startMinutes;
}

function formatTime12Hour(time24Str) {
    if (!time24Str) return "";
    const [h, m] = time24Str.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const mStr = String(m).padStart(2, '0');
    return `${h12}:${mStr} ${ampm}`;
}

function getTimeSlotRangeString(startTimeStr, endTimeStr) {
    if (!startTimeStr || !endTimeStr) return "";
    return `${formatTime12Hour(startTimeStr)} - ${formatTime12Hour(endTimeStr)}`;
}

function updateTaskDuration(startInputId, endInputId, displayId, valId) {
    const startInput = document.getElementById(startInputId);
    const endInput = document.getElementById(endInputId);
    const displaySpan = document.getElementById(displayId);
    const valInput = document.getElementById(valId);
    
    if (!startInput || !endInput || !displaySpan || !valInput) return;
    
    if (!startInput.value || !endInput.value) {
        displaySpan.innerText = "0 mins";
        valInput.value = "0";
        return;
    }
    const diff = calculateDurationFromTimes(startInput.value, endInput.value);
    displaySpan.innerText = `${diff} mins`;
    valInput.value = diff.toString();
}

function resetTimeInputs(type) {
    const prefix = type === 'plan' ? 'plan-task' : 'spontaneous-task';
    const startInput = document.getElementById(`${prefix}-start`);
    const endInput = document.getElementById(`${prefix}-end`);
    if (startInput && endInput) {
        startInput.value = "12:00";
        endInput.value = "13:00";
        updateTaskDuration(`${prefix}-start`, `${prefix}-end`, `${prefix}-duration-display`, `${prefix}-duration`);
    }
}

function bindTimeDurationCalculators() {
    const planStart = document.getElementById("plan-task-start");
    const planEnd = document.getElementById("plan-task-end");
    const spStart = document.getElementById("spontaneous-task-start");
    const spEnd = document.getElementById("spontaneous-task-end");
    
    if (planStart && planEnd) {
        planStart.addEventListener("input", () => updateTaskDuration("plan-task-start", "plan-task-end", "plan-task-duration-display", "plan-task-duration"));
        planEnd.addEventListener("input", () => updateTaskDuration("plan-task-start", "plan-task-end", "plan-task-duration-display", "plan-task-duration"));
    }
    
    if (spStart && spEnd) {
        spStart.addEventListener("input", () => updateTaskDuration("spontaneous-task-start", "spontaneous-task-end", "spontaneous-task-duration-display", "spontaneous-task-duration"));
        spEnd.addEventListener("input", () => updateTaskDuration("spontaneous-task-start", "spontaneous-task-end", "spontaneous-task-duration-display", "spontaneous-task-duration"));
    }
    
    // Set initial values
    resetTimeInputs('plan');
    resetTimeInputs('spontaneous');
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
    
    const totalDays = 371; // 53 weeks * 7 days for a complete full-year view
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
    
    let favoriteCategory = "Other";
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
    
    const rangeType = document.getElementById("analytics-time-range")?.value || "7";
    const lastNDays = [];
    
    // Toggle custom date picker visibility
    const customDatesContainer = document.getElementById("analytics-custom-dates");
    if (customDatesContainer) {
        customDatesContainer.style.display = rangeType === "custom" ? "flex" : "none";
    }
    
    if (rangeType === "custom") {
        let startVal = document.getElementById("analytics-start-date")?.value;
        let endVal = document.getElementById("analytics-end-date")?.value;
        
        if (startVal && endVal) {
            let temp = startVal;
            const end = endVal;
            while (temp <= end) {
                lastNDays.push(temp);
                temp = addDays(temp, 1);
            }
        } else {
            // Default to last 30 days if inputs are not filled yet
            const startDateDefault = addDays(today, -29);
            const startInput = document.getElementById("analytics-start-date");
            const endInput = document.getElementById("analytics-end-date");
            if (startInput) startInput.value = startDateDefault;
            if (endInput) endInput.value = today;
            
            let temp = startDateDefault;
            while (temp <= today) {
                lastNDays.push(temp);
                temp = addDays(temp, 1);
            }
        }
    } else if (rangeType === "all") {
        const startDateStr = "2026-06-15";
        const start = startDateStr < today ? startDateStr : addDays(today, -6);
        let temp = start;
        while (temp <= today) {
            lastNDays.push(temp);
            temp = addDays(temp, 1);
        }
    } else {
        const rangeDays = parseInt(rangeType);
        for (let i = rangeDays - 1; i >= 0; i--) {
            lastNDays.push(addDays(today, -i));
        }
    }
    
    const rangeDays = lastNDays.length;
    
    // Dynamically adjust trendChartWrapper width to allow horizontal scrolling
    const trendWrapper = document.getElementById("trendChartWrapper");
    if (trendWrapper) {
        const parentWidth = trendWrapper.parentElement.clientWidth;
        const calcWidth = rangeDays * 55; // 55px per day for clear labels spacing
        trendWrapper.style.width = Math.max(parentWidth, calcWidth) + "px";
    }
    
    const labels = lastNDays.map(d => formatDateShort(d));
    const completionRates = lastNDays.map(d => {
        const dayTasks = state.tasks.filter(t => t.date === d);
        if (dayTasks.length === 0) return 0;
        const comp = dayTasks.filter(t => t.completed).length;
        return Math.round((comp / dayTasks.length) * 100);
    });
    
    const focusRatings = lastNDays.map(d => {
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
    
    const categoryTotals = CATEGORIES.map(c => {
        const totalMins = state.tasks
            .filter(t => t.category === c && t.completed)
            .reduce((sum, t) => sum + t.duration, 0);
        return Math.round(totalMins);
    });
    
    if (distChartInstance) distChartInstance.destroy();
    
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
    
    // Auto-scroll the trend chart to today's date on the far right
    setTimeout(() => {
        const chartContainer = document.getElementById("trendChartWrapper")?.parentElement;
        if (chartContainer) {
            chartContainer.scrollLeft = chartContainer.scrollWidth;
        }
    }, 100);
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

function initializeApp() {
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
            showToast("Account created! Waiting for administrator approval.");
            document.getElementById("tab-btn-login").click();
        }
    });
    
    // Logout Action
    document.getElementById("btn-logout").addEventListener("click", async () => {
        await supabaseClient.auth.signOut();
        showToast("Logged out successfully.");
    });
    
    // Logout Action on Pending Approval Screen
    document.getElementById("btn-pending-logout").addEventListener("click", async () => {
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
    
    // Bind Time & Duration auto-calculators
    bindTimeDurationCalculators();
    
    // Spontaneous task logger
    document.getElementById("form-spontaneous-task").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("spontaneous-task-name").value;
        const category = document.getElementById("spontaneous-task-category").value;
        
        const spStart = document.getElementById("spontaneous-task-start").value;
        const spEnd = document.getElementById("spontaneous-task-end").value;
        const duration = document.getElementById("spontaneous-task-duration").value;
        const timeSlot = getTimeSlotRangeString(spStart, spEnd);
        
        addSpontaneousTask(name, category, duration, timeSlot);
        document.getElementById("form-spontaneous-task").reset();
        resetTimeInputs('spontaneous');
    });
    
    // Planned task scheduler
    document.getElementById("form-plan-task").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("plan-task-name").value;
        const category = document.getElementById("plan-task-category").value;
        
        const planStart = document.getElementById("plan-task-start").value;
        const planEnd = document.getElementById("plan-task-end").value;
        const duration = document.getElementById("plan-task-duration").value;
        const target = document.querySelector('input[name="plan-task-target"]:checked').value;
        const timeSlot = getTimeSlotRangeString(planStart, planEnd);
        
        addTask(name, category, duration, target, timeSlot);
        
        document.getElementById("plan-task-name").value = "";
        resetTimeInputs('plan');
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
    
    // Analytics time range selector bindings
    document.getElementById("analytics-time-range")?.addEventListener("change", () => {
        renderCharts();
    });
    
    document.getElementById("analytics-start-date")?.addEventListener("change", () => {
        renderCharts();
    });
    
    document.getElementById("analytics-end-date")?.addEventListener("change", () => {
        renderCharts();
    });
    window.toggleTask = toggleTask;
    window.deleteTask = deleteTask;
    
    // Start midnight rollover checker
    startMidnightCheck();
}

let isAutoFinalizing = false;

function startMidnightCheck() {
    logProgress("Starting midnight rollover check timer...");
    setInterval(async () => {
        if (!currentUser || !state.currentDate || isAutoFinalizing) return;
        
        const actualDate = getSystemDate(state.systemOffsetDays);
        if (actualDate > state.currentDate) {
            isAutoFinalizing = true;
            logProgress("Midnight rollover detected! Auto-finalizing day: " + state.currentDate);
            showToast("Midnight rollover! Auto-finalizing study day...", "warning");
            
            // Close reflection modal if open
            toggleReflectionModal(false);
            
            try {
                // Auto finalize the day
                await finalizeDay(
                    0, 
                    "neutral", 
                    "Auto-finalized: Day rolled over at midnight."
                );
            } catch (err) {
                console.error("Auto-finalization failed:", err);
            } finally {
                isAutoFinalizing = false;
            }
        }
    }, 30000); // Check every 30 seconds
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
} else {
    initializeApp();
}
