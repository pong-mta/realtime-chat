import { Head } from "@inertiajs/react";
import axios from "axios";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import "../../lib/echo";

type User = {
    id: number;
    name: string;
    email: string;
};

type Message = {
    id: number;
    conversation_id: number;
    sender_id: number;
    body: string;
    image_path: string | null;
    image_url: string | null;
    created_at: string;
    sender: User;
};

type ConversationSummary = {
    id: number;
    participants: User[];
    last_message_at: string | null;
};

type Props = {
    contacts: User[];
    conversations: ConversationSummary[];
    currentUser: User;
};

export default function ChatIndex({
    contacts,
    conversations: initialConversations,
    currentUser,
}: Props) {
    const [conversations, setConversations] = useState(initialConversations);
    const [activeId, setActiveId] = useState<number | null>(
        initialConversations[0]?.id ?? null,
    );

    const [messages, setMessages] = useState<Message[]>([]);
    const [draft, setDraft] = useState("");
    const [search, setSearch] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    // Image upload state
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);

    const bottomRef = useRef<HTMLDivElement>(null);
    const messageContainerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);

    const activeConversation = conversations.find(
        (conversation) => conversation.id === activeId,
    );

    const activeContact =
        activeConversation?.participants.find(
            (participant) => participant.id !== currentUser.id,
        ) ?? null;

    const filteredContacts = useMemo(() => {
        const query = search.toLowerCase().trim();

        if (!query) return contacts;

        return contacts.filter(
            (contact) =>
                contact.name.toLowerCase().includes(query) ||
                contact.email.toLowerCase().includes(query),
        );
    }, [contacts, search]);

    const filteredConversations = useMemo(() => {
        const query = search.toLowerCase().trim();

        if (!query) return conversations;

        return conversations.filter((conversation) => {
            const participant = conversation.participants.find(
                (user) => user.id !== currentUser.id,
            );

            return (
                participant?.name.toLowerCase().includes(query) ||
                participant?.email.toLowerCase().includes(query)
            );
        });
    }, [conversations, currentUser.id, search]);

    // Revoke temporary image preview URL when it changes or component unmounts.
    useEffect(() => {
        return () => {
            if (imagePreview) {
                URL.revokeObjectURL(imagePreview);
            }
        };
    }, [imagePreview]);

    // Load messages and listen for real-time messages.
    useEffect(() => {
        if (!activeId) {
            setMessages([]);
            return;
        }

        let mounted = true;
        const channelName = `conversation.${activeId}`;

        setMessages([]);
        setError("");

        // Load existing messages independently of the real-time connection.
        axios
            .get(`/chat/${activeId}/messages`)
            .then((response) => {
                if (mounted) {
                    setMessages(response.data.messages ?? []);
                }
            })
            .catch(() => {
                if (mounted) {
                    setError("Unable to load messages.");
                }
            });

        // Echo is initialized by the side-effect import at the top of this file.
        if (!window.Echo) {
            console.error(
                "Laravel Echo is unavailable. Check your Pusher configuration.",
            );

            setError(
                "Real-time connection unavailable. Messages can still be loaded, but live updates are disabled.",
            );

            return () => {
                mounted = false;
            };
        }

        // Subscribe to the active conversation's private channel.
        const channel = window.Echo.private(channelName);

        channel
            .subscribed(() => {
                console.log("Subscribed to private channel:", channelName);
            })
            .error((subscriptionError: unknown) => {
                console.error(
                    "Private channel subscription failed:",
                    channelName,
                    subscriptionError,
                );

                if (mounted) {
                    setError(
                        "Unable to join this private conversation. Please check your connection.",
                    );
                }
            })
            .listen(".message.sent", (event: { message: Message }) => {
                console.log("Incoming chat message:", event.message);

                if (!mounted) return;

                setMessages((previous) => {
                    if (
                        previous.some(
                            (message) => message.id === event.message.id,
                        )
                    ) {
                        return previous;
                    }

                    return [...previous, event.message];
                });
            });

        return () => {
            mounted = false;
            window.Echo.leave(channelName);
        };
    }, [activeId]);

    // Scroll only the message container to the latest message.
    useEffect(() => {
        const container = messageContainerRef.current;

        if (!container) return;

        container.scrollTop = container.scrollHeight;
    }, [messages]);

    async function openConversation(user: User) {
        setBusy(true);
        setError("");

        try {
            const response = await axios.post(`/chat/start/${user.id}`);

            const conversation: ConversationSummary = {
                ...response.data.conversation,
                participants: response.data.conversation.participants ?? [
                    currentUser,
                    user,
                ],
                last_message_at:
                    response.data.conversation.last_message_at ?? null,
            };

            setConversations((previous) => {
                const exists = previous.some(
                    (item) => item.id === conversation.id,
                );

                if (exists) {
                    return previous;
                }

                return [conversation, ...previous];
            });

            setActiveId(conversation.id);
        } catch {
            setError("Unable to open this conversation.");
        } finally {
            setBusy(false);
        }
    }

    function handleImageSelection(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];

        if (!file) return;

        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

        if (!allowedTypes.includes(file.type)) {
            setError("Please select a JPG, PNG, or WebP image.");
            event.target.value = "";
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            setError("Image must not exceed 5 MB.");
            event.target.value = "";
            return;
        }

        setError("");
        setSelectedImage(file);
        setImagePreview(URL.createObjectURL(file));
    }

    function removeSelectedImage() {
        setSelectedImage(null);
        setImagePreview(null);

        if (imageInputRef.current) {
            imageInputRef.current.value = "";
        }
    }

    async function sendMessage(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!activeId || (!draft.trim() && !selectedImage) || busy) {
            return;
        }

        const formData = new FormData();

        formData.append("body", draft.trim());

        if (selectedImage) {
            formData.append("image", selectedImage);
        }

        setBusy(true);
        setError("");

        try {
            const response = await axios.post(
                `/chat/${activeId}/messages`,
                formData,
            );

            const newMessage: Message = response.data.message;

            setMessages((previous) => {
                if (previous.some((message) => message.id === newMessage.id)) {
                    return previous;
                }

                return [...previous, newMessage];
            });

            setDraft("");
            setSelectedImage(null);
            setImagePreview(null);

            if (imageInputRef.current) {
                imageInputRef.current.value = "";
            }

            setConversations((previous) =>
                previous.map((conversation) =>
                    conversation.id === activeId
                        ? {
                              ...conversation,
                              last_message_at: newMessage.created_at,
                          }
                        : conversation,
                ),
            );
        } catch (err: any) {
            const validationErrors = err.response?.data?.errors;

            const firstValidationError = validationErrors
                ? Object.values(validationErrors).flat()[0]
                : null;

            setError(
                (firstValidationError as string) ||
                    err.response?.data?.message ||
                    "Unable to send your message. Please try again.",
            );
        } finally {
            setBusy(false);
        }
    }

    function formatTime(date: string) {
        return new Date(date).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function formatConversationTime(date: string | null) {
        if (!date) return "";

        return new Date(date).toLocaleDateString([], {
            month: "short",
            day: "numeric",
        });
    }

    return (
        <>
            <Head title="Messages" />

            <div className="h-[calc(100dvh-4rem)] w-full min-w-0 overflow-hidden bg-white text-slate-900">
                <div className="flex h-full w-full min-w-0 overflow-hidden">
                    {/* SIDEBAR */}
                    <aside
                        className={`flex h-full w-full shrink-0 flex-col border-r border-slate-200 bg-white md:w-[340px] lg:w-[370px] ${
                            activeId ? "hidden md:flex" : "flex"
                        }`}
                    >
                        {/* Sidebar header */}
                        <div className="shrink-0 border-b border-slate-100 px-6 py-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
                                            <MessageIcon />
                                        </div>

                                        <div>
                                            <h1 className="text-xl font-bold tracking-tight text-slate-900">
                                                Messages
                                            </h1>
                                            <p className="text-xs text-slate-500">
                                                Private conversations
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600">
                                    Online
                                </div>
                            </div>
                        </div>

                        {/* Current user */}
                        <div className="shrink-0 px-5 py-4">
                            <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                                <Avatar name={currentUser.name} size="md" />

                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-slate-900">
                                        {currentUser.name}
                                    </p>
                                    <p className="truncate text-xs text-slate-500">
                                        {currentUser.email}
                                    </p>
                                </div>

                                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-100" />
                            </div>
                        </div>

                        {/* Search */}
                        <div className="shrink-0 px-5 pb-4">
                            <div className="relative">
                                <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                                    <SearchIcon />
                                </div>

                                <input
                                    type="text"
                                    value={search}
                                    onChange={(event) =>
                                        setSearch(event.target.value)
                                    }
                                    placeholder="Search conversations or people..."
                                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                                />
                            </div>
                        </div>

                        {/* Conversation list */}
                        <div className="min-h-0 flex-1 overflow-hidden">
                            <div className="px-5 pb-2">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                        Recent conversations
                                    </h2>

                                    <span className="text-xs font-medium text-slate-400">
                                        {filteredConversations.length}
                                    </span>
                                </div>
                            </div>

                            <div className="overflow-hidden px-3">
                                {filteredConversations.length === 0 ? (
                                    <p className="px-3 py-5 text-sm text-slate-400">
                                        No conversations yet.
                                    </p>
                                ) : (
                                    filteredConversations.map(
                                        (conversation) => {
                                            const participant =
                                                conversation.participants.find(
                                                    (user) =>
                                                        user.id !==
                                                        currentUser.id,
                                                );

                                            if (!participant) return null;

                                            const selected =
                                                activeId === conversation.id;

                                            return (
                                                <button
                                                    key={conversation.id}
                                                    type="button"
                                                    onClick={() =>
                                                        setActiveId(
                                                            conversation.id,
                                                        )
                                                    }
                                                    className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${
                                                        selected
                                                            ? "bg-indigo-50"
                                                            : "hover:bg-slate-50"
                                                    }`}
                                                >
                                                    <Avatar
                                                        name={participant.name}
                                                        size="lg"
                                                    />

                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p
                                                                className={`truncate text-sm font-semibold ${
                                                                    selected
                                                                        ? "text-indigo-700"
                                                                        : "text-slate-800"
                                                                }`}
                                                            >
                                                                {
                                                                    participant.name
                                                                }
                                                            </p>

                                                            <span className="shrink-0 text-[10px] text-slate-400">
                                                                {formatConversationTime(
                                                                    conversation.last_message_at,
                                                                )}
                                                            </span>
                                                        </div>

                                                        <p className="mt-1 truncate text-xs text-slate-400">
                                                            {participant.email}
                                                        </p>
                                                    </div>
                                                </button>
                                            );
                                        },
                                    )
                                )}
                            </div>

                            {/* People */}
                            <div className="mt-5 px-5 pb-2">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                        Start a conversation
                                    </h2>

                                    <span className="text-xs font-medium text-slate-400">
                                        {filteredContacts.length}
                                    </span>
                                </div>
                            </div>

                            <div className="overflow-hidden px-3">
                                {filteredContacts.length === 0 ? (
                                    <p className="px-3 py-4 text-sm text-slate-400">
                                        No people found.
                                    </p>
                                ) : (
                                    filteredContacts.map((contact) => (
                                        <button
                                            key={contact.id}
                                            type="button"
                                            disabled={busy}
                                            onClick={() =>
                                                openConversation(contact)
                                            }
                                            className="mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-slate-50 disabled:opacity-50"
                                        >
                                            <Avatar
                                                name={contact.name}
                                                size="md"
                                            />

                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-semibold text-slate-800">
                                                    {contact.name}
                                                </p>
                                                <p className="truncate text-xs text-slate-400">
                                                    {contact.email}
                                                </p>
                                            </div>

                                            <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">
                                                Chat
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Sidebar footer */}
                        <div className="shrink-0 border-t border-slate-100 px-5 py-3">
                            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                                <ShieldIcon />
                                Private messaging
                            </div>
                        </div>
                    </aside>

                    {/* CHAT PANEL */}
                    <main
                        className={`h-full min-w-0 flex-1 flex-col overflow-hidden bg-[#f8f9fc] ${
                            activeId ? "flex" : "hidden md:flex"
                        }`}
                    >
                        {activeConversation && activeContact ? (
                            <>
                                {/* Chat header - fixed */}
                                <header className="z-10 flex h-[76px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-7">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setActiveId(null)}
                                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden"
                                        >
                                            <BackIcon />
                                        </button>

                                        <Avatar
                                            name={activeContact.name}
                                            size="lg"
                                        />

                                        <div className="min-w-0">
                                            <h2 className="truncate text-sm font-bold text-slate-900 sm:text-base">
                                                {activeContact.name}
                                            </h2>
                                            <p className="truncate text-xs text-slate-400">
                                                {activeContact.email}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <div className="hidden items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-600 sm:flex">
                                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                            Private conversation
                                        </div>

                                        <button
                                            type="button"
                                            className="rounded-full p-2.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                                            title="More options"
                                        >
                                            <MoreIcon />
                                        </button>
                                    </div>
                                </header>

                                {/* ONLY SCROLLABLE AREA: messages */}
                                <div
                                    ref={messageContainerRef}
                                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 lg:px-12"
                                >
                                    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
                                        <div className="flex justify-center">
                                            <span className="rounded-full bg-white px-4 py-2 text-[11px] font-medium text-slate-400 shadow-sm">
                                                This is the beginning of your
                                                conversation
                                            </span>
                                        </div>

                                        {messages.map((message) => {
                                            const isMine =
                                                message.sender_id ===
                                                currentUser.id;

                                            return (
                                                <div
                                                    key={message.id}
                                                    className={`flex w-full ${
                                                        isMine
                                                            ? "justify-end"
                                                            : "justify-start"
                                                    }`}
                                                >
                                                    {!isMine && (
                                                        <div className="mr-3 mt-auto">
                                                            <Avatar
                                                                name={
                                                                    message
                                                                        .sender
                                                                        .name
                                                                }
                                                                size="sm"
                                                            />
                                                        </div>
                                                    )}

                                                    <div
                                                        className={`flex max-w-[85%] flex-col sm:max-w-[70%] ${
                                                            isMine
                                                                ? "items-end"
                                                                : "items-start"
                                                        }`}
                                                    >
                                                        <div
                                                            className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                                                                isMine
                                                                    ? "rounded-br-md bg-indigo-600 text-white"
                                                                    : "rounded-bl-md border border-slate-200 bg-white text-slate-700"
                                                            }`}
                                                        >
                                                            {/* Shared image */}
                                                            {message.image_url && (
                                                                <a
                                                                    href={
                                                                        message.image_url
                                                                    }
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="mb-2 block overflow-hidden rounded-xl"
                                                                >
                                                                    <img
                                                                        src={
                                                                            message.image_url
                                                                        }
                                                                        alt="Shared image"
                                                                        loading="lazy"
                                                                        className="max-h-[350px] max-w-full rounded-xl object-contain"
                                                                    />
                                                                </a>
                                                            )}

                                                            {/* Message text */}
                                                            {message.body && (
                                                                <p className="whitespace-pre-wrap break-words">
                                                                    {
                                                                        message.body
                                                                    }
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div className="mt-1.5 flex items-center gap-1.5 px-1">
                                                            <span className="text-[10px] text-slate-400">
                                                                {formatTime(
                                                                    message.created_at,
                                                                )}
                                                            </span>

                                                            {isMine && (
                                                                <span className="text-indigo-500">
                                                                    <CheckIcon />
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        <div ref={bottomRef} />
                                    </div>
                                </div>

                                {/* Error and composer - fixed */}
                                <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-4 sm:px-8">
                                    <div className="mx-auto w-full max-w-5xl">
                                        {/* Error message */}
                                        {error && (
                                            <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
                                                {error}
                                            </div>
                                        )}

                                        {/* Image preview */}
                                        {imagePreview && (
                                            <div className="mb-3 flex items-start gap-3">
                                                <div className="relative">
                                                    <img
                                                        src={imagePreview}
                                                        alt="Selected image preview"
                                                        className="h-24 w-24 rounded-xl border border-slate-200 object-cover"
                                                    />

                                                    <button
                                                        type="button"
                                                        onClick={
                                                            removeSelectedImage
                                                        }
                                                        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-sm text-white shadow-md transition hover:bg-red-600"
                                                        title="Remove image"
                                                    >
                                                        ×
                                                    </button>
                                                </div>

                                                <div className="min-w-0 pt-1">
                                                    <p className="truncate text-xs font-semibold text-slate-700">
                                                        {selectedImage?.name}
                                                    </p>
                                                    <p className="text-[11px] text-slate-400">
                                                        {selectedImage
                                                            ? (
                                                                  selectedImage.size /
                                                                  1024 /
                                                                  1024
                                                              ).toFixed(2) +
                                                              " MB"
                                                            : ""}
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        <form
                                            onSubmit={sendMessage}
                                            className="flex items-end gap-3"
                                        >
                                            {/* Hidden image input */}
                                            <input
                                                ref={imageInputRef}
                                                type="file"
                                                accept="image/jpeg,image/png,image/webp"
                                                className="hidden"
                                                onChange={handleImageSelection}
                                            />

                                            {/* Attach image button */}
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    imageInputRef.current?.click()
                                                }
                                                disabled={busy}
                                                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                                                title="Attach image"
                                            >
                                                <ImageIcon />
                                            </button>

                                            {/* Message input */}
                                            <div className="flex min-h-[52px] min-w-0 flex-1 items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 transition focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-indigo-50">
                                                <textarea
                                                    value={draft}
                                                    onChange={(event) =>
                                                        setDraft(
                                                            event.target.value,
                                                        )
                                                    }
                                                    onKeyDown={(event) => {
                                                        if (
                                                            event.key ===
                                                                "Enter" &&
                                                            !event.shiftKey
                                                        ) {
                                                            event.preventDefault();

                                                            if (
                                                                (draft.trim() ||
                                                                    selectedImage) &&
                                                                !busy
                                                            ) {
                                                                event.currentTarget.form?.requestSubmit();
                                                            }
                                                        }
                                                    }}
                                                    placeholder="Write your message..."
                                                    rows={1}
                                                    maxLength={5000}
                                                    className="max-h-32 min-h-[24px] w-full resize-none border-0 bg-transparent py-3 text-sm text-slate-700 outline-none ring-0 placeholder:text-slate-400 focus:border-0 focus:outline-none focus:ring-0"
                                                />
                                            </div>

                                            {/* Send button */}
                                            <button
                                                type="submit"
                                                disabled={
                                                    (!draft.trim() &&
                                                        !selectedImage) ||
                                                    busy ||
                                                    !activeId
                                                }
                                                className="flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {busy ? (
                                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                                ) : (
                                                    <SendIcon />
                                                )}

                                                <span className="hidden sm:inline">
                                                    Send
                                                </span>
                                            </button>
                                        </form>

                                        <p className="mt-2 text-center text-[10px] text-slate-400">
                                            Press Enter to send · Shift + Enter
                                            for a new line · Images up to 5 MB
                                        </p>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex h-full flex-1 flex-col items-center justify-center px-6 text-center">
                                <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-[30px] bg-indigo-50 text-indigo-500">
                                    <MessageIcon size={42} />
                                </div>

                                <h2 className="text-2xl font-bold tracking-tight text-slate-800">
                                    Your conversations, in real time
                                </h2>

                                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
                                    Select a conversation from the sidebar or
                                    choose someone to start a private
                                    conversation.
                                </p>

                                <div className="mt-6 flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-slate-500 shadow-sm">
                                    <ShieldIcon />
                                    Private messaging
                                </div>
                            </div>
                        )}
                    </main>
                </div>
            </div>
        </>
    );
}

/* AVATAR */

function Avatar({
    name,
    size = "md",
}: {
    name: string;
    size?: "sm" | "md" | "lg";
}) {
    const dimensions = {
        sm: "h-8 w-8 text-[10px]",
        md: "h-10 w-10 text-xs",
        lg: "h-12 w-12 text-sm",
    };

    return (
        <div
            className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 font-bold text-white shadow-sm ${dimensions[size]}`}
        >
            {getInitials(name)}
        </div>
    );
}

function getInitials(name: string) {
    return name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
}

/* ICONS */

function MessageIcon({ size = 20 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
        </svg>
    );
}

function SearchIcon() {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
        </svg>
    );
}

function BackIcon() {
    return (
        <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m15 18-6-6 6-6" />
        </svg>
    );
}

function MoreIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
        </svg>
    );
}

function SendIcon() {
    return (
        <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m22 2-7 20-4-9-9-4Z" />
            <path d="M22 2 11 13" />
        </svg>
    );
}

function ImageIcon() {
    return (
        <svg
            width="21"
            height="21"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
        </svg>
    );
}

function ShieldIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
            <path d="m9 12 2 2 4-4" />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m5 12 4 4L19 6" />
        </svg>
    );
}
