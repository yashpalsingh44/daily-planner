package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "github.com/glebarez/go-sqlite"
)

// initTestDB initializes an in-memory SQLite database for testing
func initTestDB(t *testing.T) {
	var err error
	db, err = sql.Open("sqlite", ":memory:?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatalf("Failed to open test database: %v", err)
	}

	createUsersSQL := `
	CREATE TABLE users (
		id TEXT PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		email TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at TEXT NOT NULL
	);`
	if _, err := db.Exec(createUsersSQL); err != nil {
		t.Fatalf("Failed to init users table: %v", err)
	}

	createTasksSQL := `
	CREATE TABLE tasks (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL DEFAULT 'default_user',
		title TEXT NOT NULL,
		desc TEXT,
		date TEXT NOT NULL,
		start TEXT NOT NULL,
		end TEXT NOT NULL,
		status TEXT NOT NULL,
		reminder BOOLEAN NOT NULL,
		completed_at TEXT
	);`
	if _, err := db.Exec(createTasksSQL); err != nil {
		t.Fatalf("Failed to init tasks table: %v", err)
	}
}

func TestPasswordHashing(t *testing.T) {
	password := "SecretPass123!"
	hashed, err := hashPassword(password)
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}

	if !verifyPassword(password, hashed) {
		t.Errorf("verifyPassword failed for correct password")
	}

	if verifyPassword("WrongPassword", hashed) {
		t.Errorf("verifyPassword passed for incorrect password")
	}
}

func TestJWTAuthentication(t *testing.T) {
	userID := "user_test_123"
	username := "alex_test"

	token, err := generateJWT(userID, username)
	if err != nil {
		t.Fatalf("generateJWT failed: %v", err)
	}

	sub, name, err := parseJWT(token)
	if err != nil {
		t.Fatalf("parseJWT failed: %v", err)
	}

	if sub != userID || name != username {
		t.Errorf("JWT claims mismatch: got (%s, %s), expected (%s, %s)", sub, name, userID, username)
	}

	// Invalid token check
	_, _, err = parseJWT("invalid.jwt.token")
	if err == nil {
		t.Errorf("parseJWT expected error for invalid token string")
	}
}

func TestTaskValidation(t *testing.T) {
	validTask := Task{
		Title: "Coding Task",
		Date:  "2026-07-28",
		Start: "10:00",
		End:   "11:30",
	}
	if err := validateTask(validTask); err != nil {
		t.Errorf("validateTask failed on valid task: %v", err)
	}

	// Empty title
	invalidTitle := validTask
	invalidTitle.Title = "   "
	if err := validateTask(invalidTitle); err == nil {
		t.Errorf("validateTask should reject empty title")
	}

	// Bad date format
	invalidDate := validTask
	invalidDate.Date = "28-07-2026"
	if err := validateTask(invalidDate); err == nil {
		t.Errorf("validateTask should reject invalid date format")
	}

	// Backwards time range
	invalidTime := validTask
	invalidTime.Start = "12:00"
	invalidTime.End = "11:00"
	if err := validateTask(invalidTime); err == nil {
		t.Errorf("validateTask should reject end time earlier than start time")
	}
}

func TestUserRegistrationAndLogin(t *testing.T) {
	initTestDB(t)
	defer db.Close()

	// Register User
	regPayload := AuthRequest{
		Username: "tester",
		Email:    "tester@aetherplan.com",
		Password: "password123",
	}
	jsonBody, _ := json.Marshal(regPayload)

	req := httptest.NewRequest("POST", "/api/auth/register", bytes.NewBuffer(jsonBody))
	w := httptest.NewRecorder()
	registerHandler(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("registerHandler returned status %d, body: %s", w.Code, w.Body.String())
	}

	var res AuthResponse
	json.NewDecoder(w.Body).Decode(&res)
	if res.Token == "" || res.User.Username != "tester" {
		t.Errorf("Registration response invalid: %+v", res)
	}

	// Duplicate Registration Check
	wDup := httptest.NewRecorder()
	reqDup := httptest.NewRequest("POST", "/api/auth/register", bytes.NewBuffer(jsonBody))
	registerHandler(wDup, reqDup)
	if wDup.Code != http.StatusConflict {
		t.Errorf("Duplicate registration should return 409 Conflict, got %d", wDup.Code)
	}

	// Login User
	loginPayload := AuthRequest{
		Email:    "tester@aetherplan.com",
		Password: "password123",
	}
	loginBody, _ := json.Marshal(loginPayload)
	reqLogin := httptest.NewRequest("POST", "/api/auth/login", bytes.NewBuffer(loginBody))
	wLogin := httptest.NewRecorder()
	loginHandler(wLogin, reqLogin)

	if wLogin.Code != http.StatusOK {
		t.Fatalf("loginHandler failed with code %d", wLogin.Code)
	}
}

func TestTaskCRUDAndMultiUserIsolation(t *testing.T) {
	initTestDB(t)
	defer db.Close()

	tokenUserA, _ := generateJWT("user_A", "User A")
	tokenUserB, _ := generateJWT("user_B", "User B")

	// User A creates task
	taskA := Task{
		Title:    "User A Confidential Plan",
		Desc:     "Private notes for A",
		Date:     "2026-07-28",
		Start:    "09:00",
		End:      "10:00",
		Status:   "todo",
		Reminder: true,
	}
	bodyA, _ := json.Marshal(taskA)
	reqA := httptest.NewRequest("POST", "/api/tasks", bytes.NewBuffer(bodyA))
	reqA.Header.Set("Authorization", "Bearer "+tokenUserA)
	wA := httptest.NewRecorder()
	createTaskHandler(wA, reqA)

	if wA.Code != http.StatusCreated {
		t.Fatalf("createTaskHandler failed for User A, code %d", wA.Code)
	}

	var createdTask Task
	json.NewDecoder(wA.Body).Decode(&createdTask)

	// User B queries tasks
	reqB := httptest.NewRequest("GET", "/api/tasks", nil)
	reqB.Header.Set("Authorization", "Bearer "+tokenUserB)
	wB := httptest.NewRecorder()
	getTasksHandler(wB, reqB)

	var tasksB []Task
	json.NewDecoder(wB.Body).Decode(&tasksB)

	// User B should not see User A's task
	for _, tItem := range tasksB {
		if tItem.ID == createdTask.ID {
			t.Errorf("Multi-User Isolation Failure: User B accessed User A's task!")
		}
	}

	// User B attempts to delete User A's task
	reqDel := httptest.NewRequest("DELETE", "/api/tasks/"+createdTask.ID, nil)
	reqDel.Header.Set("Authorization", "Bearer "+tokenUserB)
	wDel := httptest.NewRecorder()
	deleteTaskHandler(wDel, reqDel)

	if wDel.Code != http.StatusNotFound {
		t.Errorf("User B deleting User A's task should be forbidden/404, got %d", wDel.Code)
	}

	// User A deletes task successfully
	reqDelA := httptest.NewRequest("DELETE", "/api/tasks/"+createdTask.ID, nil)
	reqDelA.Header.Set("Authorization", "Bearer "+tokenUserA)
	wDelA := httptest.NewRecorder()
	deleteTaskHandler(wDelA, reqDelA)

	if wDelA.Code != http.StatusOK {
		t.Errorf("User A deletion failed with status %d", wDelA.Code)
	}
}

func TestTaskRecurrence(t *testing.T) {
	dailyTask := Task{
		Date:       "2026-07-28", // Tuesday
		Recurrence: "daily",
	}

	if !matchesRecurrence(dailyTask, "2026-07-29") {
		t.Errorf("Daily task should match next day 2026-07-29")
	}
	if matchesRecurrence(dailyTask, "2026-07-27") {
		t.Errorf("Daily task should not match prior date 2026-07-27")
	}

	weeklyTask := Task{
		Date:       "2026-07-28", // Tuesday
		Recurrence: "weekly",
	}
	if !matchesRecurrence(weeklyTask, "2026-08-04") { // Following Tuesday
		t.Errorf("Weekly task should match following Tuesday 2026-08-04")
	}
	if matchesRecurrence(weeklyTask, "2026-08-05") { // Wednesday
		t.Errorf("Weekly task should not match Wednesday 2026-08-05")
	}
}
