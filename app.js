// ====================================================================
// Globale Datenstruktur und Konstanten
// ====================================================================
const STORAGE_KEY = 'PrivacyPlannerData';
const IV_KEY = 'PrivacyPlannerIV';
const ALGORITHM = { name: "AES-GCM", iv: new Uint8Array(12) };

let MASTER_KEY; 
let APP_DATA = {
    todos: [],
    sessions: [],
    notes: "",
    mood: 3
};

// ====================================================================
// I. Kernfunktionen: Verschlüsselung und Laden
// ====================================================================

const Crypto = {
    // Leitet einen kryptographischen Schlüssel aus dem Passwort ab
    deriveKey: async function(password) {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
        );
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: encoder.encode("privacy-planner-salt"), iterations: 100000, hash: "SHA-256" },
            keyMaterial, ALGORITHM, true, ["encrypt", "decrypt"]
        );
    },

    // Verschlüsselt Daten mit dem abgeleiteten Schlüssel
    encrypt: async function(data, key) {
        const encoder = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        ALGORITHM.iv = iv;

        const ciphertext = await crypto.subtle.encrypt(ALGORITHM, key, encoder.encode(data));

        const ivString = btoa(String.fromCharCode.apply(null, iv));
        localStorage.setItem(IV_KEY, ivString);

        return btoa(String.fromCharCode.apply(null, new Uint8Array(ciphertext)));
    },

    // Entschlüsselt Daten
    decrypt: async function(base64Ciphertext, key) {
        const ivString = localStorage.getItem(IV_KEY);
        if (!ivString) throw new Error("IV fehlt.");

        const iv = Uint8Array.from(atob(ivString), c => c.charCodeAt(0));
        ALGORITHM.iv = iv;

        const buffer = Uint8Array.from(atob(base64Ciphertext), c => c.charCodeAt(0));

        const plaintext = await crypto.subtle.decrypt(ALGORITHM, key, buffer);

        const decoder = new TextDecoder();
        return decoder.decode(plaintext);
    }
};

const APP = {
    // 💾 Speichert alle aktuellen App-Daten
    saveData: async function() {
        if (!MASTER_KEY) return;
        
        // Daten aus DOM aktualisieren
        APP_DATA.notes = document.getElementById('notes-input').value;
        APP_DATA.mood = document.getElementById('mood-slider').value;

        try {
            const encrypted = await Crypto.encrypt(JSON.stringify(APP_DATA), MASTER_KEY);
            localStorage.setItem(STORAGE_KEY, encrypted);
            document.getElementById('save-button').textContent = "✅ Gespeichert!";
            setTimeout(() => document.getElementById('save-button').textContent = "💾 Speichern", 2000);
        } catch (e) {
            alert("Speichern fehlgeschlagen! Daten möglicherweise zu groß.");
        }
    },

    // Lädt die App-Daten
    loadData: async function() {
        const encrypted = localStorage.getItem(STORAGE_KEY);
        if (!encrypted) return;

        try {
            const decrypted = await Crypto.decrypt(encrypted, MASTER_KEY);
            APP_DATA = JSON.parse(decrypted);
            APP.renderAll();
        } catch (e) {
            alert("Fehler beim Entschlüsseln! Falsches Passwort oder beschädigte Daten.");
            document.getElementById('password-info').textContent = "Falsches Passwort! Bitte erneut versuchen.";
            document.getElementById('password-screen').style.display = 'block';
            document.getElementById('main-content').style.display = 'none';
            MASTER_KEY = null;
        }
    },

    // Initialisiert die App nach Passworteingabe (Passwortschutz)
    initApp: async function() {
        const password = document.getElementById('master-password').value;
        if (!password) { alert("Bitte ein Passwort eingeben."); return; }

        try {
            MASTER_KEY = await Crypto.deriveKey(password);
            await APP.loadData();
            
            document.getElementById('password-screen').style.display = 'none';
            document.getElementById('main-content').style.display = 'grid';

            if (localStorage.getItem(STORAGE_KEY) === null) {
                 alert("Neues Passwort festgelegt. Ihre Daten sind nun verschlüsselt!");
            }

        } catch(e) { console.error("Init Error:", e); alert("Fehler bei der Key-Ableitung."); }
    },
    
    // 7. Fokus-Modus
    toggleFocusMode: function() {
        document.getElementById('main-content').classList.toggle('focus-mode');
    },

    // Dark Mode Umschalter
    toggleMode: function() {
        const body = document.body;
        body.classList.toggle('dark-mode');
        body.classList.toggle('light-mode');
        document.getElementById('mode-toggle').textContent = body.classList.contains('dark-mode') ? "🌙" : "☀️";
    },

    // Rendert alle Daten auf der Seite
    renderAll: function() {
        // To-Dos
        const todoList = document.getElementById('todo-list');
        todoList.innerHTML = APP_DATA.todos.map(t => `
            <div class="task-item ${t.done ? 'done' : ''}" data-id="${t.id}">
                <span onclick="TODO.toggleDone(${t.id})">${t.text} ${t.isRecurring ? '🔄' : ''}</span>
                <button onclick="TODO.deleteTask(${t.id})">x</button>
            </div>
        `).join('');
        
        // Timer-Sessions
        const sessionLog = document.getElementById('session-log');
        sessionLog.innerHTML = APP_DATA.sessions.slice(-5).reverse().map(s => {
            const duration = Math.floor(s.durationMs / 1000);
            const minutes = String(Math.floor(duration / 60)).padStart(2, '0');
            const seconds = String(duration % 60).padStart(2, '0');
            return `<li>${s.name}: ${minutes}:${seconds}</li>`;
        }).join('');
        document.getElementById('tracked-time-count').textContent = APP_DATA.sessions.length;

        // Notizen (initial setzen und Markdown-Vorschau triggern)
        const notesInput = document.getElementById('notes-input');
        notesInput.value = APP_DATA.notes;
        notesInput.dispatchEvent(new Event('input')); 

        // Mood-Slider (1. Mood Tracker)
        document.getElementById('mood-slider').value = APP_DATA.mood;
        document.getElementById('mood-slider').dispatchEvent(new Event('input'));
    }
};

// ====================================================================
// II. Aufgaben (To-Do List) und Mood Tracker
// ====================================================================

const TODO = {
    add: function() {
        const input = document.getElementById('todo-input');
        const text = input.value.trim();
        if (text === "") return;

        // 4. Wiederkehrende Aufgaben: Fragt nach wöchentlicher Wiederholung
        const isRecurring = confirm("Soll diese Aufgabe wöchentlich wiederholt werden (🔄)?");

        APP_DATA.todos.push({
            id: Date.now(),
            text: text,
            done: false,
            isRecurring: isRecurring,
            dueDate: new Date().toISOString() // Für Wiederholungslogik
        });

        input.value = '';
        APP.renderAll();
        APP.saveData();
    },

    toggleDone: function(id) {
        const task = APP_DATA.todos.find(t => t.id === id);
        if (task) {
            task.done = !task.done;
            
            // Logik für Wiederkehrende Aufgabe: Wenn erledigt, neue erstellen
            if (task.done && task.isRecurring) {
                // Erstellt die neue Aufgabe für die nächste Woche
                let nextDueDate = new Date();
                nextDueDate.setDate(nextDueDate.getDate() + 7); 
                
                APP_DATA.todos.push({
                    id: Date.now(),
                    text: task.text,
                    done: false,
                    isRecurring: true,
                    dueDate: nextDueDate.toISOString()
                });
            }
            
            APP.renderAll();
            APP.saveData();
        }
    },

    deleteTask: function(id) {
        APP_DATA.todos = APP_DATA.todos.filter(t => t.id !== id);
        APP.renderAll();
        APP.saveData();
    }
};

// Mood Tracker Logik (1)
const moodSlider = document.getElementById('mood-slider');
moodSlider.addEventListener('input', () => {
    const value = moodSlider.value;
    const moodLabels = ["Sehr schlecht 😠", "Schlecht 🙁", "Neutral 😐", "Gut 🙂", "Sehr gut 😄"];
    document.getElementById('mood-output').textContent = moodLabels[value - 1] + ` (${value}/5)`;
    APP_DATA.mood = value;
    // Speichern wird durch den allgemeinen Speichern-Button oder App-Ende getriggert
});


// ====================================================================
// III. Stoppuhr Tracker mit Titel
// ====================================================================

const TIMER = {
    interval: null,
    startTime: 0,
    elapsedTime: 0,
    isRunning: false,
    
    startStop: function() {
        if (!TIMER.isRunning) {
            TIMER.startTime = Date.now() - TIMER.elapsedTime;
            TIMER.interval = setInterval(TIMER.updateDisplay, 1000);
            TIMER.isRunning = true;
            document.querySelector('#timer-column button:nth-child(4)').textContent = 'Stopp';
        } else {
            clearInterval(TIMER.interval);
            TIMER.isRunning = false;
            document.querySelector('#timer-column button:nth-child(4)').textContent = 'Weiter';
        }
    },
    
    updateDisplay: function() {
        TIMER.elapsedTime = Date.now() - TIMER.startTime;
        const totalSeconds = Math.floor(TIMER.elapsedTime / 1000);
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        document.getElementById('timer-display').textContent = `${hours}:${minutes}:${seconds}`;
    },

    saveSession: function() {
        if (TIMER.elapsedTime === 0) return;
        
        const name = document.getElementById('timer-name').value.trim();
        if (name === "") { alert("Bitte geben Sie einen Titel für die Session ein."); return; }

        clearInterval(TIMER.interval);
        
        APP_DATA.sessions.push({
            name: name,
            durationMs: TIMER.elapsedTime,
            date: new Date().toISOString()
        });

        // Zurücksetzen
        TIMER.elapsedTime = 0;
        TIMER.isRunning = false;
        document.getElementById('timer-name').value = '';
        document.getElementById('timer-display').textContent = "00:00:00";
        document.querySelector('#timer-column button:nth-child(4)').textContent = 'Start';
        
        APP.renderAll();
        APP.saveData();
    }
};

// ====================================================================
// IV. Erweiterungen: Markdown & Bild-Drop
// ====================================================================

// 6. Markdown-Vorschau (Einfache Implementation)
document.getElementById('notes-input').addEventListener('input', (e) => {
    const rawText = e.target.value;
    let html = rawText;
    
    // Markdown-Regeln:
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>'); // **fett**
    html = html.replace(/#(.*)/g, '<h3>$1</h3>'); // # Titel
    
    // Bilder-Handling: Base64-Strings als Bilder rendern
    html = html.replace(/\[Image-Start\]\n(.*?)\n\[Image-End\]/gs, (match, base64) => {
        return `<img src="${base64}" style="max-width: 100%; height: auto; display: block; margin: 10px 0;">`;
    });
    
    document.getElementById('notes-preview').innerHTML = html;
});

// 7. Drag & Drop Bild (Base64-Speicherung)
const dropArea = document.getElementById('image-drop-area');
dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.style.backgroundColor = 'rgba(0,123,255,0.1)'; });
dropArea.addEventListener('dragleave', (e) => { dropArea.style.backgroundColor = 'transparent'; });
dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.style.backgroundColor = 'transparent';

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Image = event.target.result;
            // Fügt das Base64-Bild mit Markern zur textarea hinzu
            const notes = document.getElementById('notes-input');
            notes.value += `\n[Image-Start]\n${base64Image}\n[Image-End]\n`;
            notes.dispatchEvent(new Event('input')); // Aktualisiert die Vorschau
            APP.saveData();
            alert("Bild erfolgreich lokal gespeichert (als Text in Base64).");
        };
        reader.readAsDataURL(file);
    } else {
        alert("Bitte nur Bilder in den Bereich ziehen.");
    }
});
