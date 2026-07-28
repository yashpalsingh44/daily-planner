package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/glebarez/go-sqlite"
)

// User represents a registered user profile
type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	Email        string `json:"email"`
	PasswordHash string `json:"-"`
	CreatedAt    string `json:"createdAt"`
}

// AuthRequest represents a login or registration payload
type AuthRequest struct {
	Username string `json:"username,omitempty"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// AuthResponse represents token and profile response
type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

// Task represents a scheduled planner task associated with a user
type Task struct {
	ID          string `json:"id"`
	UserID      string `json:"userId"`
	Title       string `json:"title"`
	Desc        string `json:"desc"`
	Date        string `json:"date"`
	Start       string `json:"start"`
	End         string `json:"end"`
	Status      string `json:"status"`
	Reminder    bool   `json:"reminder"`
	Recurrence  string `json:"recurrence"`
	CompletedAt string `json:"completedAt,omitempty"`
}

// EventPayload represents a real-time SSE notification message
type EventPayload struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Task    *Task  `json:"task,omitempty"`
	Time    string `json:"time"`
}

// SSEBroker handles thread-safe client event channels
type SSEBroker struct {
	clients map[chan string]bool
	mu      sync.RWMutex
}

var broker = &SSEBroker{
	clients: make(map[chan string]bool),
}

func (b *SSEBroker) AddClient(ch chan string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.clients[ch] = true
}

func (b *SSEBroker) RemoveClient(ch chan string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, exists := b.clients[ch]; exists {
		delete(b.clients, ch)
		close(ch)
	}
}

func (b *SSEBroker) Broadcast(eventType string, data interface{}) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	jsonData, err := json.Marshal(data)
	if err != nil {
		log.Printf("SSE Marshal error: %v", err)
		return
	}

	msg := fmt.Sprintf("event: %s\ndata: %s\n\n", eventType, string(jsonData))
	for ch := range b.clients {
		select {
		case ch <- msg:
		default:
			// Non-blocking send: skip if channel buffer is full
		}
	}
}

var jwtSecret = []byte("aetherplan_super_secret_jwt_key_2026")

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	saltHex := hex.EncodeToString(salt)
	hash := sha256.Sum256([]byte(saltHex + password))
	return fmt.Sprintf("%s$%s", saltHex, hex.EncodeToString(hash[:])), nil
}

func verifyPassword(password, storedHash string) bool {
	parts := strings.Split(storedHash, "$")
	if len(parts) != 2 {
		return false
	}
	salt := parts[0]
	hash := sha256.Sum256([]byte(salt + password))
	return hex.EncodeToString(hash[:]) == parts[1]
}

func generateJWT(userID, username string) (string, error) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	exp := time.Now().Add(24 * time.Hour).Unix()
	payloadStr := fmt.Sprintf(`{"sub":"%s","name":"%s","exp":%d}`, userID, username, exp)
	payload := base64.RawURLEncoding.EncodeToString([]byte(payloadStr))

	signatureInput := header + "." + payload
	h := hmac.New(sha256.New, jwtSecret)
	h.Write([]byte(signatureInput))
	signature := base64.RawURLEncoding.EncodeToString(h.Sum(nil))

	return signatureInput + "." + signature, nil
}

func parseJWT(tokenStr string) (string, string, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return "", "", fmt.Errorf("invalid token format")
	}

	signatureInput := parts[0] + "." + parts[1]
	h := hmac.New(sha256.New, jwtSecret)
	h.Write([]byte(signatureInput))
	expectedSignature := base64.RawURLEncoding.EncodeToString(h.Sum(nil))

	if expectedSignature != parts[2] {
		return "", "", fmt.Errorf("invalid token signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", "", err
	}

	var claims struct {
		Sub  string `json:"sub"`
		Name string `json:"name"`
		Exp  int64  `json:"exp"`
	}
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return "", "", err
	}

	if time.Now().Unix() > claims.Exp {
		return "", "", fmt.Errorf("token expired")
	}

	return claims.Sub, claims.Name, nil
}

func getUserFromRequest(r *http.Request) (string, string) {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		sub, name, err := parseJWT(tokenStr)
		if err == nil {
			return sub, name
		}
	}
	return "default_user", "Guest"
}

var db *sql.DB

func initDB() {
	dbDir := "./data"
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		log.Printf("Warning: failed to create data dir: %v", err)
	}

	dbPath := filepath.Join(dbDir, "tasks.db?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("Failed to open SQLite database at %s: %v", dbPath, err)
	}
	db.SetMaxOpenConns(1)

	// Create users table
	createUsersSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		email TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at TEXT NOT NULL
	);`
	if _, err := db.Exec(createUsersSQL); err != nil {
		log.Fatalf("Failed to initialize users schema: %v", err)
	}

	// Create tasks table if not exists
	createTasksSQL := `
	CREATE TABLE IF NOT EXISTS tasks (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL DEFAULT 'default_user',
		title TEXT NOT NULL,
		desc TEXT,
		date TEXT NOT NULL,
		start TEXT NOT NULL,
		end TEXT NOT NULL,
		status TEXT NOT NULL,
		reminder BOOLEAN NOT NULL,
		recurrence TEXT NOT NULL DEFAULT 'none',
		completed_at TEXT
	);`

	if _, err = db.Exec(createTasksSQL); err != nil {
		log.Fatalf("Failed to initialize tasks schema: %v", err)
	}

	// Soft schema migrations
	db.Exec(`ALTER TABLE tasks ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default_user';`)
	db.Exec(`ALTER TABLE tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none';`)

	log.Printf("Database initialized successfully at %s", dbPath)
}

func enableCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

func validateTask(t Task) error {
	if strings.TrimSpace(t.Title) == "" {
		return fmt.Errorf("task title cannot be empty")
	}
	if _, err := time.Parse("2006-01-02", t.Date); err != nil {
		return fmt.Errorf("invalid date format (expected YYYY-MM-DD)")
	}
	startTime, err := time.Parse("15:04", t.Start)
	if err != nil {
		return fmt.Errorf("invalid start time format (expected HH:MM)")
	}
	endTime, err := time.Parse("15:04", t.End)
	if err != nil {
		return fmt.Errorf("invalid end time format (expected HH:MM)")
	}
	if !endTime.After(startTime) {
		return fmt.Errorf("end time must be strictly after start time")
	}

	validRecurrence := map[string]bool{"": true, "none": true, "daily": true, "weekdays": true, "weekly": true, "monthly": true}
	if !validRecurrence[t.Recurrence] {
		return fmt.Errorf("invalid recurrence pattern: %s", t.Recurrence)
	}

	return nil
}

func validateAuthRequest(req AuthRequest, isRegister bool) error {
	email := strings.TrimSpace(req.Email)
	password := strings.TrimSpace(req.Password)
	if isRegister {
		username := strings.TrimSpace(req.Username)
		if username == "" {
			return fmt.Errorf("username is required")
		}
		if len(username) < 3 {
			return fmt.Errorf("username must be at least 3 characters")
		}
	}
	if email == "" {
		return fmt.Errorf("email or username is required")
	}
	if len(password) < 4 {
		return fmt.Errorf("password must be at least 4 characters")
	}
	return nil
}

// POST /api/auth/register
func registerHandler(w http.ResponseWriter, r *http.Request) {
	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	if err := validateAuthRequest(req, true); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Password = strings.TrimSpace(req.Password)

	// Check existing
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ? OR username = ?", req.Email, req.Username).Scan(&count)
	if count > 0 {
		http.Error(w, "User with this email or username already exists", http.StatusConflict)
		return
	}

	passHash, err := hashPassword(req.Password)
	if err != nil {
		http.Error(w, "Password processing failed", http.StatusInternalServerError)
		return
	}

	u := User{
		ID:        fmt.Sprintf("user_%d", time.Now().UnixNano()),
		Username:  req.Username,
		Email:     req.Email,
		CreatedAt: time.Now().Format(time.RFC3339),
	}

	_, err = db.Exec("INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
		u.ID, u.Username, u.Email, passHash, u.CreatedAt)
	if err != nil {
		http.Error(w, "Failed to register user account", http.StatusInternalServerError)
		return
	}

	token, _ := generateJWT(u.ID, u.Username)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(AuthResponse{Token: token, User: u})
}

// POST /api/auth/login
func loginHandler(w http.ResponseWriter, r *http.Request) {
	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	if err := validateAuthRequest(req, false); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	identifier := strings.ToLower(strings.TrimSpace(req.Email))
	if identifier == "" {
		identifier = strings.TrimSpace(req.Username)
	}

	var u User
	var passHash string
	err := db.QueryRow("SELECT id, username, email, password_hash, created_at FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?", identifier, identifier).
		Scan(&u.ID, &u.Username, &u.Email, &passHash, &u.CreatedAt)

	if err != nil || !verifyPassword(req.Password, passHash) {
		http.Error(w, "Invalid username/email or password credentials", http.StatusUnauthorized)
		return
	}

	token, _ := generateJWT(u.ID, u.Username)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{Token: token, User: u})
}

// GET /api/auth/me
func meHandler(w http.ResponseWriter, r *http.Request) {
	userID, _ := getUserFromRequest(r)
	if userID == "default_user" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var u User
	var passHash string
	err := db.QueryRow("SELECT id, username, email, password_hash, created_at FROM users WHERE id = ?", userID).
		Scan(&u.ID, &u.Username, &u.Email, &passHash, &u.CreatedAt)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(u)
}

// Helper to check if a task recurs on targetDate
func matchesRecurrence(t Task, targetDateStr string) bool {
	if t.Recurrence == "" || t.Recurrence == "none" {
		return t.Date == targetDateStr
	}

	taskDate, err1 := time.Parse("2006-01-02", t.Date)
	targetDate, err2 := time.Parse("2006-01-02", targetDateStr)
	if err1 != nil || err2 != nil {
		return t.Date == targetDateStr
	}

	if targetDate.Before(taskDate) {
		return false
	}

	switch t.Recurrence {
	case "daily":
		return true
	case "weekdays":
		wd := targetDate.Weekday()
		return wd >= time.Monday && wd <= time.Friday
	case "weekly":
		return targetDate.Weekday() == taskDate.Weekday()
	case "monthly":
		return targetDate.Day() == taskDate.Day()
	default:
		return t.Date == targetDateStr
	}
}

// GET /api/tasks
func getTasksHandler(w http.ResponseWriter, r *http.Request) {
	userID, _ := getUserFromRequest(r)
	dateParam := r.URL.Query().Get("date")

	rows, err := db.Query("SELECT id, user_id, title, desc, date, start, end, status, reminder, COALESCE(recurrence, 'none'), COALESCE(completed_at, '') FROM tasks WHERE user_id = ? OR user_id = 'default_user'", userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to query tasks: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tasks := []Task{}
	for rows.Next() {
		var t Task
		var completedAt string
		if err := rows.Scan(&t.ID, &t.UserID, &t.Title, &t.Desc, &t.Date, &t.Start, &t.End, &t.Status, &t.Reminder, &t.Recurrence, &completedAt); err != nil {
			http.Error(w, fmt.Sprintf("Error scanning task: %v", err), http.StatusInternalServerError)
			return
		}
		t.CompletedAt = completedAt

		if dateParam == "" || matchesRecurrence(t, dateParam) {
			if dateParam != "" && t.Recurrence != "" && t.Recurrence != "none" {
				t.Date = dateParam
			}
			tasks = append(tasks, t)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tasks)
}

// POST /api/tasks
func createTaskHandler(w http.ResponseWriter, r *http.Request) {
	userID, _ := getUserFromRequest(r)
	var t Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, "Invalid task JSON payload", http.StatusBadRequest)
		return
	}

	if err := validateTask(t); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if t.ID == "" {
		t.ID = fmt.Sprintf("task_%d", time.Now().UnixNano())
	}
	t.UserID = userID
	if t.Status == "" {
		t.Status = "todo"
	}
	if t.Recurrence == "" {
		t.Recurrence = "none"
	}

	t.Title = html.EscapeString(strings.TrimSpace(t.Title))
	t.Desc = html.EscapeString(strings.TrimSpace(t.Desc))

	stmt := `INSERT INTO tasks (id, user_id, title, desc, date, start, end, status, reminder, recurrence, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := db.Exec(stmt, t.ID, t.UserID, t.Title, t.Desc, t.Date, t.Start, t.End, t.Status, t.Reminder, t.Recurrence, t.CompletedAt)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to insert task: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(t)
}

// PUT /api/tasks/{id}
func updateTaskHandler(w http.ResponseWriter, r *http.Request) {
	userID, _ := getUserFromRequest(r)
	id := r.PathValue("id")
	if id == "" {
		id = strings.TrimPrefix(r.URL.Path, "/api/tasks/")
	}

	var t Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, "Invalid task JSON payload", http.StatusBadRequest)
		return
	}

	if err := validateTask(t); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if t.Recurrence == "" {
		t.Recurrence = "none"
	}

	t.Title = html.EscapeString(strings.TrimSpace(t.Title))
	t.Desc = html.EscapeString(strings.TrimSpace(t.Desc))

	stmt := `UPDATE tasks SET title=?, desc=?, date=?, start=?, end=?, status=?, reminder=?, recurrence=?, completed_at=? WHERE id=? AND (user_id=? OR user_id='default_user')`
	res, err := db.Exec(stmt, t.Title, t.Desc, t.Date, t.Start, t.End, t.Status, t.Reminder, t.Recurrence, t.CompletedAt, id, userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to update task: %v", err), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Task not found or access denied", http.StatusNotFound)
		return
	}

	t.ID = id
	t.UserID = userID
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(t)
}

// DELETE /api/tasks/{id}
func deleteTaskHandler(w http.ResponseWriter, r *http.Request) {
	userID, _ := getUserFromRequest(r)
	id := r.PathValue("id")
	if id == "" {
		id = strings.TrimPrefix(r.URL.Path, "/api/tasks/")
	}

	stmt := `DELETE FROM tasks WHERE id=? AND (user_id=? OR user_id='default_user')`
	res, err := db.Exec(stmt, id, userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to delete task: %v", err), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Task not found or access denied", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Task deleted successfully", "id": id})
}

// GET /api/events - Server-Sent Events Endpoint
func sseHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
		return
	}

	messageChan := make(chan string, 10)
	broker.AddClient(messageChan)
	defer broker.RemoveClient(messageChan)

	// Send welcome connection message
	welcomeEvent := EventPayload{
		Type:    "connection",
		Message: "Connected to ChronosPlan SSE Event Stream",
		Time:    time.Now().Format("15:04:05"),
	}
	welcomeJSON, _ := json.Marshal(welcomeEvent)
	fmt.Fprintf(w, "event: init\ndata: %s\n\n", string(welcomeJSON))
	flusher.Flush()

	notify := r.Context().Done()
	for {
		select {
		case <-notify:
			return
		case msg, ok := <-messageChan:
			if !ok {
				return
			}
			fmt.Fprint(w, msg)
			flusher.Flush()
		}
	}
}

// POST /api/tasks/test-reminder - Trigger instant test notification
func testReminderHandler(w http.ResponseWriter, r *http.Request) {
	userID, _ := getUserFromRequest(r)
	sampleTask := Task{
		ID:       "task_test",
		UserID:   userID,
		Title:    "⚡ Test Live Reminder Alert",
		Desc:     "This is a test notification generated from ChronosPlan SSE Server daemon.",
		Date:     time.Now().Format("2006-01-02"),
		Start:    time.Now().Format("15:04"),
		End:      time.Now().Add(30 * time.Minute).Format("15:04"),
		Status:   "todo",
		Reminder: true,
	}

	event := EventPayload{
		Type:    "reminder",
		Message: fmt.Sprintf("REMINDER: Task '%s' is starting now!", sampleTask.Title),
		Task:    &sampleTask,
		Time:    time.Now().Format("15:04:05"),
	}

	broker.Broadcast("reminder", event)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"message": "Test reminder broadcasted to all SSE clients",
		"task":    sampleTask,
	})
}

// Background reminder ticker
func startReminderDaemon() {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		for range ticker.C {
			now := time.Now()
			dateStr := now.Format("2006-01-02")
			timeStr := now.Format("15:04")

			rows, err := db.Query("SELECT id, user_id, title, desc, date, start, end, status, reminder, COALESCE(completed_at, '') FROM tasks WHERE date = ? AND start = ? AND reminder = 1 AND status != 'completed'", dateStr, timeStr)
			if err != nil {
				continue
			}

			for rows.Next() {
				var t Task
				var completedAt string
				if err := rows.Scan(&t.ID, &t.UserID, &t.Title, &t.Desc, &t.Date, &t.Start, &t.End, &t.Status, &t.Reminder, &completedAt); err == nil {
					t.CompletedAt = completedAt
					log.Printf("[ChronosAgent Daemon] ALERT REMINDER: Task '%s' (User: %s) is starting now at %s!", t.Title, t.UserID, timeStr)

					// Broadcast real-time SSE event
					event := EventPayload{
						Type:    "reminder",
						Message: fmt.Sprintf("Task '%s' starts now (%s)", t.Title, timeStr),
						Task:    &t,
						Time:    now.Format("15:04:05"),
					}
					broker.Broadcast("reminder", event)
				}
			}
			rows.Close()
		}
	}()
}

func main() {
	initDB()
	defer db.Close()

	startReminderDaemon()

	mux := http.NewServeMux()

	// Auth Endpoints
	mux.HandleFunc("POST /api/auth/register", enableCORS(registerHandler))
	mux.HandleFunc("POST /api/auth/login", enableCORS(loginHandler))
	mux.HandleFunc("GET /api/auth/me", enableCORS(meHandler))

	// REST Task Endpoints
	mux.HandleFunc("GET /api/tasks", enableCORS(getTasksHandler))
	mux.HandleFunc("POST /api/tasks", enableCORS(createTaskHandler))
	mux.HandleFunc("PUT /api/tasks/{id}", enableCORS(updateTaskHandler))
	mux.HandleFunc("DELETE /api/tasks/{id}", enableCORS(deleteTaskHandler))
	mux.HandleFunc("GET /api/events", enableCORS(sseHandler))
	mux.HandleFunc("POST /api/tasks/test-reminder", enableCORS(testReminderHandler))

	// Serve Static Frontend Files from ./public
	fs := http.FileServer(http.Dir("./public"))
	mux.Handle("/", fs)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	fmt.Printf("\n🚀 ChronosPlan Go Server running at http://localhost:%s\n", port)
	fmt.Printf("📁 Serving frontend static assets from ./public\n")
	fmt.Printf("🔐 Auth Endpoints: /api/auth/register, /api/auth/login, /api/auth/me\n")
	fmt.Printf("📡 SSE Real-Time Event Stream at http://localhost:%s/api/events\n", port)
	fmt.Printf("💾 Persisting data to SQLite database at ./data/tasks.db\n\n")

	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server stopped: %v", err)
	}
}

