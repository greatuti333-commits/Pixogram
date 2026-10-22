import {
  auth, db, storage,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile,
  collection, addDoc, query, orderBy, onSnapshot,
  serverTimestamp, doc, setDoc, getDoc,
  where, getDocs, limit, ref, uploadBytes, getDownloadURL
} from "./firebase.js";
document.getElementById("loginForm").addEventListener("submit", function(event) {
    event.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    console.log("Login form submitted");
    
    // Run your actual authentication code here.
});
const $ = id => document.getElementById(id);

let signupMode = false;
let currentUser = null;
let activeContact = null;
let unsubscribeMessages = null;
let unsubscribeUsers = null;
let mediaRecorder = null;
let audioChunks = [];
let localStream = null;
let peerConnection = null;
let unsubscribeCall = null;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function showStatus(message) {
  $("statusMessage").textContent = message;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function makeChatId(a, b) {
  return [a, b].sort().join("_");
}

function getConversationRef(contact) {
  return collection(
    db,
    "chats",
    makeChatId(currentUser.uid, contact.uid),
    "messages"
  );
}

$("toggleAuth").addEventListener("click", () => {
  signupMode = !signupMode;

  $("displayName").classList.toggle("hidden", !signupMode);
  $("displayName").required = signupMode;

  $("authSubmit").textContent =
    signupMode ? "Create account" : "Sign in";

  $("toggleAuth").textContent =
    signupMode ? "Already have an account? Sign in" :
    "Need an account? Sign up";

  $("authError").textContent = "";
});

$("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("authError").textContent = "";

  try {
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;

    if (signupMode) {
      const name = $("displayName").value.trim();

      if (!name) throw new Error("Enter your name.");

      const credential = await createUserWithEmailAndPassword(
        auth, email, password
      );

      await updateProfile(credential.user, {
        displayName: name
      });

      await setDoc(doc(db, "users", credential.user.uid), {
        uid: credential.user.uid,
        name,
        email,
        createdAt: serverTimestamp()
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    $("authError").textContent =
      error.message || "Authentication failed.";
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await stopCall();
  await signOut(auth);
});

onAuthStateChanged(auth, async user => {
  currentUser = user;

  $("authScreen").classList.toggle("hidden", !!user);
  $("messenger").classList.toggle("hidden", !user);

  if (!user) {
    cleanupChat();
    if (unsubscribeUsers) unsubscribeUsers();
    activeContact = null;
    return;
  }

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      name: user.displayName || "Connect User",
      email: user.email,
      createdAt: serverTimestamp()
    });
  }

  $("myName").textContent = user.displayName || user.email;
  $("myAvatar").textContent =
    (user.displayName || user.email).slice(0, 2).toUpperCase();

  subscribeUsers();
});

function subscribeUsers() {
  if (unsubscribeUsers) unsubscribeUsers();

  const q = query(
    collection(db, "users"),
    orderBy("name"),
    limit(100)
  );

  unsubscribeUsers = onSnapshot(q, snapshot => {
    renderUsers(snapshot.docs.map(d => d.data()));
  }, error => {
    showStatus("Could not load users: " + error.message);
  });
}

function renderUsers(users) {
  const search = $("userSearch").value.trim().toLowerCase();

  $("contactList").innerHTML = "";

  users
    .filter(user =>
      user.uid !== currentUser.uid &&
      (
        (user.name || "").toLowerCase().includes(search) ||
        (user.email || "").toLowerCase().includes(search)
      )
    )
    .forEach(user => {
      const element = document.createElement("div");

      element.className = "contact";
      element.innerHTML = `
        <div class="avatar">
          ${escapeHTML((user.name || "?").slice(0, 2).toUpperCase())}
        </div>
        <div class="contact-info">
          <strong>${escapeHTML(user.name || "User")}</strong>
          <small>${escapeHTML(user.email || "")}</small>
        </div>
      `;

      element.addEventListener("click", () => openChat(user));
      $("contactList").appendChild(element);
    });
}

$("userSearch").addEventListener("input", async () => {
  const q = query(
    collection(db, "users"),
    orderBy("name"),
    limit(100)
  );

  try {
    const snapshot = await getDocs(q);
    renderUsers(snapshot.docs.map(d => d.data()));
  } catch (error) {
    showStatus(error.message);
  }
});

function cleanupChat() {
  if (unsubscribeMessages) unsubscribeMessages();
  unsubscribeMessages = null;
}

function openChat(contact) {
  activeContact = contact;
  cleanupChat();

  $("messenger").classList.add("chat-open");
  $("chatName").textContent = contact.name || contact.email;
  $("chatAvatar").textContent =
    (contact.name || "?").slice(0, 2).toUpperCase();
  $("chatStatus").textContent = contact.email || "Connect user";

  $("messages").innerHTML = "";

  const q = query(
    getConversationRef(contact),
    orderBy("createdAt", "asc"),
    limit(200)
  );

  unsubscribeMessages = onSnapshot(q, snapshot => {
    $("messages").innerHTML = "";

    snapshot.forEach(documentSnapshot => {
      const message = documentSnapshot.data();
      const element = document.createElement("div");

      element.className =
        "message " +
        (message.senderId === currentUser.uid ? "sent" : "received");

      let content = escapeHTML(message.text || "");

      if (message.fileURL) {
        const url = escapeHTML(message.fileURL);
        const type = message.fileType || "";

        if (type.startsWith("image/")) {
          content += `<a href="${url}" target="_blank" rel="noopener">
            <img src="${url}" alt="Shared image" loading="lazy">
          </a>`;
        } else if (type.startsWith("video/")) {
          content += `<video src="${url}" controls></video>`;
        } else if (type.startsWith("audio/")) {
          content += `<audio src="${url}" controls></audio>`;
        } else {
          content += `<p><a href="${url}" target="_blank"
            rel="noopener">Download attachment</a></p>`;
        }
      }

      element.innerHTML = content +
        `<time>${message.createdAt?.toDate
          ? message.createdAt.toDate().toLocaleTimeString([], {
              hour: "2-digit", minute: "2-digit"
            })
          : "Sending..."}</time>`;

      $("messages").appendChild(element);
    });

    $("messages").scrollTop = $("messages").scrollHeight;
  }, error => {
    showStatus("Message error: " + error.message);
  });
}

$("backBtn").addEventListener("click", () => {
  $("messenger").classList.remove("chat-open");
});

$("messageForm").addEventListener("submit", async event => {
  event.preventDefault();

  const text = $("messageInput").value.trim();

  if (!text || !activeContact) {
    showStatus("Select a contact before sending a message.");
    return;
  }

  $("messageInput").value = "";

  try {
    await addDoc(getConversationRef(activeContact), {
      text,
      senderId: currentUser.uid,
      recipientId: activeContact.uid,
      createdAt: serverTimestamp()
    });

    showStatus("");
  } catch (error) {
    $("messageInput").value = text;
    showStatus("Message could not be sent: " + error.message);
  }
});

$("attachBtn").addEventListener("click", () => {
  $("fileInput").click();
});

$("fileInput").addEventListener("change", async () => {
  const file = $("fileInput").files[0];

  if (!file || !activeContact) {
    showStatus("Select a contact before attaching a file.");
    return;
  }

  const allowed = [
    "image/", "video/", "audio/"
  ].some(prefix => file.type.startsWith(prefix));

  const allowedDocument =
    /\.(pdf|doc|docx|txt)$/i.test(file.name);

  if (!allowed && !allowedDocument) {
    showStatus("This file type is not supported.");
    return;
  }

  if (file.size > 20 * 1024 * 1024) {
    showStatus("Files must be smaller than 20 MB.");
    return;
  }

  try {
    showStatus("Uploading file...");

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `chatUploads/${currentUser.uid}/${crypto.randomUUID()}_${safeName}`;
    const storageRef = ref(storage, path);

    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream"
    });

    const fileURL = await getDownloadURL(storageRef);

    await addDoc(getConversationRef(activeContact), {
      text: file.name,
      fileURL,
      fileType: file.type || "application/octet-stream",
      senderId: currentUser.uid,
      recipientId: activeContact.uid,
      createdAt: serverTimestamp()
    });

    showStatus("File sent.");
  } catch (error) {
    showStatus("Upload failed: " + error.message);
  } finally {
    $("fileInput").value = "";
  }
});

$("themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem(
    "connect-theme",
    document.body.classList.contains("dark") ? "dark" : "light"
  );
});

if (localStorage.getItem("connect-theme") === "dark") {
  document.body.classList.add("dark");
}
$("recordBtn").addEventListener("click", async () => {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    $("recordBtn").textContent = "🎙️";
    return;
  }

  if (!activeContact) {
    showStatus("Select a contact first.");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showStatus("Microphone access requires HTTPS or localhost.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = event => {
      if (event.data.size) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(audioChunks, {
          type: mediaRecorder.mimeType || "audio/webm"
        });

        const path =
          `chatUploads/${currentUser.uid}/${crypto.randomUUID()}.webm`;

        const storageRef = ref(storage, path);

        await uploadBytes(storageRef, blob, {
          contentType: blob.type
        });

        const fileURL = await getDownloadURL(storageRef);

        await addDoc(getConversationRef(activeContact), {
          text: "Voice message",
          fileURL,
          fileType: blob.type,
          senderId: currentUser.uid,
          recipientId: activeContact.uid,
          createdAt: serverTimestamp()
        });

        showStatus("Voice message sent.");
      } catch (error) {
        showStatus("Could not send voice message: " + error.message);
      } finally {
        stream.getTracks().forEach(track => track.stop());
      }
    };

    mediaRecorder.start();
    $("recordBtn").textContent = "⏹️";
    showStatus("Recording voice message. Press stop when finished.");
  } catch (error) {
    showStatus("Microphone permission denied or unavailable.");
  }
});const loginForm = document.getElementById("loginForm");
const message = document.getElementById("message");

loginForm.addEventListener("submit", function(event) {
    event.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    if (!email || !password) {
        message.textContent = "Please enter your email and password.";
        return;
    }

    message.textContent = "The Sign In button is working!";
    
    // Add your actual authentication code here.
});