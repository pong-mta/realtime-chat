import Echo from "laravel-echo";
import Pusher from "pusher-js";

window.Pusher = Pusher;

const key = import.meta.env.VITE_PUSHER_APP_KEY;
const cluster = import.meta.env.VITE_PUSHER_APP_CLUSTER || "ap1";

if (!key) {
    console.error(
        "Pusher initialization failed: VITE_PUSHER_APP_KEY is missing.",
    );
} else {
    window.Echo = new Echo({
        broadcaster: "pusher",
        key,
        cluster,
        forceTLS: true,
    });

    console.log("Pusher initialized successfully:", {
        keyLoaded: true,
        cluster,
    });
}
