import { io as ioClient, type Socket } from "socket.io-client";

const API = process.env.LIVE_CLASS_TEST_URL ?? "http://localhost:4001";

async function login(email: string, password: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`login failed for ${email}: ${json.message}`);
  return json.data as { token: string; user: { id: string; fullName: string } };
}

function connectSocket(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(API, { auth: { token }, transports: ["websocket"] });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

function once(socket: Socket, event: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

function emitAck(socket: Socket, event: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ack on ${event}`)), 3000);
    socket.emit(event, payload, (ack: any) => {
      clearTimeout(t);
      resolve(ack);
    });
  });
}

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

async function register(fullName: string, email: string, password: string) {
  return fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, email, password }),
  }).then((r) => r.json());
}

async function main() {
  console.log("=== 1. Login as Leader (host); register + approve a real STUDENT for this test ===");
  const host = await login("leader@kwegereza.rw", "Leader@12345");

  const studentEmail = `liveclass.student.${Date.now()}@example.com`;
  await register("Yusuf Testeur", studentEmail, "Yusuf@123");
  // Approve via the leader's own permission (student.approve) exercises the
  // real approval flow rather than pre-seeding an ACTIVE account.
  const pendingList = await fetch(`${API}/api/students/pending?search=${encodeURIComponent(studentEmail)}`, {
    headers: { Authorization: `Bearer ${host.token}` },
  }).then((r) => r.json());
  const pendingId = pendingList.data[0]?.id;
  await fetch(`${API}/api/students/${pendingId}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${host.token}` },
  });
  const student = await login(studentEmail, "Yusuf@123");
  check("Freshly-approved student can log in", !!student.token);

  console.log("\n=== 2. Host starts the class (REST) ===");
  const createRes = await fetch(`${API}/api/live-classes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.token}` },
    body: JSON.stringify({ title: "Aqida Ustadh Ahmad" }),
  }).then((r) => r.json());
  check("Class creation succeeds", createRes.success === true);
  check("Class status is LIVE", createRes.data.liveClass.status === "LIVE");
  const liveClassId = createRes.data.liveClass.id;

  console.log("\n=== 3. A real STUDENT (no classroom.host permission) cannot start a class ===");
  const studentCreateAttempt = await fetch(`${API}/api/live-classes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ title: "Ntabwo bikwiye" }),
  });
  check("Student is rejected with 403 (RBAC enforced server-side)", studentCreateAttempt.status === 403);

  console.log("\n=== 4. Both connect sockets; student joins and is MUTED by default ===");
  const hostSocket = await connectSocket(host.token);
  const studentSocket = await connectSocket(student.token);

  const hostJoin = await emitAck(hostSocket, "classroom:join", { liveClassId });
  check("Host joins successfully", hostJoin.ok === true);
  check("Host's own state is role HOST", hostJoin.self.role === "HOST");

  const studentJoinedEventPromise = once(hostSocket, "classroom:participant-joined");
  const studentJoin = await emitAck(studentSocket, "classroom:join", { liveClassId });
  const joinedEvent = await studentJoinedEventPromise;

  check("Student joins successfully", studentJoin.ok === true);
  check("Student joins MUTED by default (never auto-speaking)", studentJoin.self.micState === "MUTED");
  check("Host is notified of the new participant in realtime", joinedEvent.userId === student.user.id);

  console.log("\n=== 5. Student raises hand host is notified ===");
  const handRaisedPromise = once(hostSocket, "classroom:hand-raised");
  studentSocket.emit("classroom:raise-hand", { liveClassId });
  const handRaisedEvent = await handRaisedPromise;
  check("Host receives classroom:hand-raised for the right student", handRaisedEvent.userId === student.user.id);

  console.log("\n=== 6. Non-host cannot approve a speaker ===");
  const illegalApprove = await emitAck(studentSocket, "classroom:approve-speaker", {
    liveClassId,
    targetUserId: student.user.id,
  });
  check("Student (non-host) approve attempt is rejected", illegalApprove.ok === false);

  console.log("\n=== 7. Host approves the student to speak ===");
  const approvedEventPromise = once(studentSocket, "classroom:speaker-approved");
  const approveAck = await emitAck(hostSocket, "classroom:approve-speaker", {
    liveClassId,
    targetUserId: student.user.id,
  });
  const approvedEvent = await approvedEventPromise;
  check("Approve ack ok:true", approveAck.ok === true);
  check("Student receives classroom:speaker-approved directly", approvedEvent.liveClassId === liveClassId);

  console.log("\n=== 8. WebRTC signaling relay: student -> host offer is delivered ===");
  const offerPromise = once(hostSocket, "webrtc:offer");
  studentSocket.emit("webrtc:offer", { liveClassId, toUserId: host.user.id, sdp: "FAKE_SDP_OFFER" });
  const offerReceived = await offerPromise;
  check("Host receives the offer with correct sender id", offerReceived.fromUserId === student.user.id);
  check("Offer payload passed through unmodified (opaque relay)", offerReceived.sdp === "FAKE_SDP_OFFER");

  console.log("\n=== 9. Host mutes everyone ===");
  const mutedAllAck = await emitAck(hostSocket, "classroom:mute-all", { liveClassId });
  check("mute-all ack ok:true", mutedAllAck.ok === true);

  console.log("\n=== 10. Host removes the participant ===");
  const removedEventPromise = once(studentSocket, "classroom:removed");
  const removeAck = await emitAck(hostSocket, "classroom:remove-participant", {
    liveClassId,
    targetUserId: student.user.id,
  });
  const removedEvent = await removedEventPromise;
  check("remove-participant ack ok:true", removeAck.ok === true);
  check("Removed student receives classroom:removed", removedEvent.liveClassId === liveClassId);

  console.log("\n=== 11. Host ends the class ===");
  const endAck = await emitAck(hostSocket, "classroom:end", { liveClassId });
  check("classroom:end ack ok:true", endAck.ok === true);

  const activeAfterEnd = await fetch(`${API}/api/live-classes/active`, {
    headers: { Authorization: `Bearer ${host.token}` },
  }).then((r) => r.json());
  check(
    "Ended class no longer appears in the active list",
    !activeAfterEnd.data.some((c: any) => c.id === liveClassId)
  );

  hostSocket.disconnect();
  studentSocket.disconnect();

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
