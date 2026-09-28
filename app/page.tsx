"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Bolt, CheckCircle2, Clock3, Crown, LockKeyhole, LogOut, MapPin, Plus, Settings2, ShieldCheck, UserCog, UserRound, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Role = "usuario" | "coordinador" | "administrador";
type Profile = { profileId: number; alias: string; phone: string; role: Role; notificationChannel: "app" | "email"; canManageChargers: boolean };
type Charger = { id: number; code: string; location: string; access_level: "usuario" | "coordinador"; queue_id?: number; profile_id?: number; scheduled_start?: string; started_at?: string | null; duration_minutes?: number; status?: "queued" | "active"; occupant_alias?: string };
type Turn = { id: number; charger_id: number; profile_id: number; scheduled_start: string; started_at?: string | null; duration_minutes: number; status: "queued" | "active"; charger_code: string; location: string; alias: string };
type ManagedUser = { id: number; alias: string; phone: string; role: Role; is_active: number; can_manage_chargers: number; username: string; last_login_at?: string | null };
type Data = { profile: Profile; chargers: Charger[]; queue: Turn[]; users: ManagedUser[]; now: string };

const roleLabel: Record<Role, string> = { usuario: "Usuario", coordinador: "Coordinador", administrador: "Administrador" };
const formatTime = (value?: string) => value ? new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const formatDate = (value: string) => new Intl.DateTimeFormat("es-MX", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const minutesLeft = (turn?: Turn) => !turn?.started_at ? null : Math.ceil((new Date(turn.started_at).getTime() + turn.duration_minutes * 60_000 - Date.now()) / 60_000);
const minutesUntil = (turn?: Turn) => !turn ? null : Math.ceil((new Date(turn.scheduled_start).getTime() - Date.now()) / 60_000);
const warningMilestone = (minutes: number | null) => minutes === null || minutes <= 0 ? null : minutes <= 5 ? 5 : minutes <= 10 ? 10 : minutes <= 15 ? 15 : null;

export default function Home() {
  const [screen, setScreen] = useState<"loading" | "setup" | "login" | "register" | "app">("loading");
  const [data, setData] = useState<Data | null>(null); const [error, setError] = useState(""); const [working, setWorking] = useState(false);
  const [loginUser, setLoginUser] = useState(""); const [loginPassword, setLoginPassword] = useState("");
  const [setup, setSetup] = useState({ username: "", password: "", confirm: "", alias: "", phone: "" });
  const [registration, setRegistration] = useState({ username: "", password: "", confirm: "", alias: "", phone: "" });
  const [profileOpen, setProfileOpen] = useState(false); const [chargerOpen, setChargerOpen] = useState(false); const [adminOpen, setAdminOpen] = useState(false);
  const [alias, setAlias] = useState(""); const [phone, setPhone] = useState(""); const [chargerCode, setChargerCode] = useState(""); const [chargerLocation, setChargerLocation] = useState(""); const [chargerAccess, setChargerAccess] = useState<"usuario" | "coordinador">("usuario");
  const [editing, setEditing] = useState<ManagedUser | null | undefined>(undefined);
  const [userForm, setUserForm] = useState({ username: "", password: "", confirm: "", alias: "", phone: "", role: "usuario" as Role, active: true, canManageChargers: false });
  const notified = useRef(new Set<string>());

  const loadDashboard = useCallback(async () => {
    const response = await fetch("/api/charging", { cache: "no-store" });
    const body = await response.json();
    if (response.status === 401) { setData(null); setScreen("login"); throw new Error(""); }
    if (!response.ok) throw new Error(body.error || "No fue posible cargar el tablero.");
    setData(body); setAlias(body.profile.alias); setPhone(body.profile.phone); setScreen("app");
  }, []);

  const loadAuth = useCallback(async () => {
    try {
      const response = await fetch("/api/auth", { cache: "no-store" }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No fue posible revisar el acceso.");
      if (body.user) await loadDashboard(); else setScreen(body.setupRequired ? "setup" : "login");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible abrir la aplicación."); setScreen("login"); }
  }, [loadDashboard]);
  useEffect(() => { loadAuth(); }, [loadAuth]);
  useEffect(() => { if (screen !== "app") return; const id = window.setInterval(() => loadDashboard().catch(() => undefined), 30_000); return () => window.clearInterval(id); }, [screen, loadDashboard]);

  const myTurn = useMemo(() => data?.queue.find((turn) => turn.profile_id === data.profile.profileId), [data]);
  const activeMine = myTurn?.status === "active" ? myTurn : undefined;
  const waitingMine = myTurn?.status === "queued" ? myTurn : undefined;
  const remaining = minutesLeft(activeMine); const untilMyTurn = minutesUntil(waitingMine);
  const disconnectWarning = warningMilestone(remaining); const queueWarning = warningMilestone(untilMyTurn);
  useEffect(() => { notified.current.clear(); }, [data?.profile.profileId]);
  useEffect(() => {
    if (!activeMine || remaining === null || !("Notification" in window) || Notification.permission !== "granted") return;
    const key = `finish:${activeMine.id}:${remaining <= 0 ? "late" : `warning-${disconnectWarning}`}`;
    if (notified.current.has(key)) return;
    if (remaining > 0 && !disconnectWarning) return;
    notified.current.add(key);
    new Notification(remaining <= 0 ? "Tu tiempo de carga se excedió" : `Desconecta tu vehículo en ${disconnectWarning} min`, { body: remaining <= 0 ? "Desconecta tu vehículo y libera el cargador." : `Quedan ${remaining} minutos en ${activeMine.charger_code}.` });
  }, [activeMine, disconnectWarning, remaining]);
  useEffect(() => {
    if (!waitingMine || untilMyTurn === null || !("Notification" in window) || Notification.permission !== "granted") return;
    const key = `turn:${waitingMine.id}:${untilMyTurn <= 0 ? "now" : `warning-${queueWarning}`}`;
    if (notified.current.has(key)) return;
    if (untilMyTurn > 0 && !queueWarning) return;
    notified.current.add(key);
    new Notification(untilMyTurn <= 0 ? "Ya puedes usar el cargador" : `Tu turno empieza en ${queueWarning} min`, { body: untilMyTurn <= 0 ? `Tu turno en ${waitingMine.charger_code} ya está disponible.` : `En ${untilMyTurn} minutos te toca ${waitingMine.charger_code}.` });
  }, [queueWarning, untilMyTurn, waitingMine]);

  async function send(payload: Record<string, unknown>) {
    setWorking(true); setError("");
    try { const response = await fetch("/api/charging", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo guardar el cambio."); setData(body); setAlias(body.profile.alias); setPhone(body.profile.phone); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Ocurrió un error."); }
    finally { setWorking(false); }
  }
  async function postAuth(payload: Record<string, unknown>) {
    setWorking(true); setError("");
    try { const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo iniciar sesión."); await loadDashboard(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo iniciar sesión."); }
    finally { setWorking(false); }
  }
  async function handleLogin(event: FormEvent) { event.preventDefault(); await postAuth({ action: "login", username: loginUser, password: loginPassword }); }
  async function handleSetup(event: FormEvent) { event.preventDefault(); if (setup.password !== setup.confirm) return setError("Las contraseñas no coinciden."); await postAuth({ action: "bootstrap", ...setup }); }
  async function handleRegister(event: FormEvent) { event.preventDefault(); if (registration.password !== registration.confirm) return setError("Las contraseñas no coinciden."); await postAuth({ action: "register", ...registration }); }
  async function signOut() { await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) }); setData(null); setLoginPassword(""); setScreen("login"); }
  async function enableAlerts() { if ("Notification" in window) await Notification.requestPermission(); }
  useEffect(() => {
    if (screen !== "app") return;
    type WebMCPContext = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: WebMCPContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const reserve = async (input: unknown) => {
      const chargerId = typeof input === "object" && input !== null ? Number((input as { chargerId?: unknown }).chargerId) : NaN;
      if (!Number.isInteger(chargerId)) throw new Error("chargerId debe ser un número entero.");
      const response = await fetch("/api/charging", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "join", chargerId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No fue posible apartar el cargador.");
      setData(body);
      return { status: "reserved", chargerId };
    };
    try {
      void Promise.resolve(context.registerTool({ name: "list_charger_availability", title: "Consultar cargadores", description: "Devuelve la disponibilidad actual de los cargadores.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: async () => ({ chargers: (data?.chargers || []).map((charger) => ({ id: charger.id, code: charger.code, location: charger.location, status: charger.status || "available", access: charger.access_level })) }) }, { signal: lifecycle.signal })).catch(() => undefined);
      void Promise.resolve(context.registerTool({ name: "reserve_charger", title: "Apartar cargador", description: "Aparta un cargador disponible durante dos horas para el usuario autenticado.", inputSchema: { type: "object", properties: { chargerId: { type: "integer" } }, required: ["chargerId"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: reserve }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch { /* El navegador no expone WebMCP. La interfaz visible sigue disponible. */ }
    return () => lifecycle.abort();
  }, [data?.chargers, screen]);
  function openUser(user?: ManagedUser) { setEditing(user ?? null); setUserForm(user ? { username: user.username, password: "", confirm: "", alias: user.alias, phone: user.phone, role: user.role, active: user.is_active === 1, canManageChargers: user.can_manage_chargers === 1 } : { username: "", password: "", confirm: "", alias: "", phone: "", role: "usuario", active: true, canManageChargers: false }); }
  async function saveUser() { if (userForm.password && userForm.password !== userForm.confirm) return setError("Las contraseñas no coinciden."); if (editing === null) await send({ action: "create-user", ...userForm }); else if (editing) await send({ action: "update-user", profileId: editing.id, ...userForm, isActive: userForm.active }); if (!error) setEditing(undefined); }

  if (screen === "loading") return <main className="grid min-h-screen place-items-center bg-[#eef5f7] text-[#102b3f]"><p className="animate-pulse">Cargando Carga en orden…</p></main>;
  if (screen === "setup" || screen === "login" || screen === "register") return <main className="grid min-h-screen place-items-center bg-[#eef5f7] p-5 text-[#102b3f]">
    <section className="w-full max-w-md rounded-3xl bg-white p-7 shadow-[0_24px_64px_rgba(16,43,63,.16)]">
      <div className="mb-6 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-[#102b3f] text-[#9ef0bc]"><Bolt className="fill-current" /></span><div><h1 className="text-xl font-bold">Carga en orden</h1><p className="text-sm text-slate-500">Acceso seguro al sistema de turnos</p></div></div>
      {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {screen === "setup" ? <form className="grid gap-4" onSubmit={handleSetup}><div><h2 className="font-bold">Crea la cuenta administradora</h2><p className="mt-1 text-sm text-slate-600">Esta cuenta podrá administrar usuarios y permisos.</p></div><Input placeholder="Alias" value={setup.alias} onChange={(e) => setSetup({ ...setup, alias: e.target.value })} required /><Input placeholder="Teléfono" value={setup.phone} onChange={(e) => setSetup({ ...setup, phone: e.target.value })} required /><Input placeholder="Usuario" autoComplete="username" value={setup.username} onChange={(e) => setSetup({ ...setup, username: e.target.value })} required /><Input type="password" placeholder="Contraseña (mínimo 12 caracteres)" autoComplete="new-password" value={setup.password} onChange={(e) => setSetup({ ...setup, password: e.target.value })} required /><Input type="password" placeholder="Confirma la contraseña" autoComplete="new-password" value={setup.confirm} onChange={(e) => setSetup({ ...setup, confirm: e.target.value })} required /><Button disabled={working} className="bg-[#102b3f]"><ShieldCheck /> Crear acceso administrador</Button></form> : screen === "register" ? <form className="grid gap-4" onSubmit={handleRegister}><div><h2 className="font-bold">Crear cuenta</h2><p className="mt-1 text-sm text-slate-600">Tu cuenta tendrá acceso de usuario. Administración asigna permisos adicionales.</p></div><Input placeholder="Alias" autoComplete="nickname" value={registration.alias} onChange={(e) => setRegistration({ ...registration, alias: e.target.value })} required /><Input placeholder="Teléfono" autoComplete="tel" value={registration.phone} onChange={(e) => setRegistration({ ...registration, phone: e.target.value })} required /><Input placeholder="Usuario" autoComplete="username" value={registration.username} onChange={(e) => setRegistration({ ...registration, username: e.target.value })} required /><Input type="password" placeholder="Contraseña (mínimo 12 caracteres)" autoComplete="new-password" value={registration.password} onChange={(e) => setRegistration({ ...registration, password: e.target.value })} required /><Input type="password" placeholder="Confirma la contraseña" autoComplete="new-password" value={registration.confirm} onChange={(e) => setRegistration({ ...registration, confirm: e.target.value })} required /><Button disabled={working} className="bg-[#102b3f]"><UserRound /> Crear cuenta</Button><Button type="button" variant="link" onClick={() => { setError(""); setScreen("login"); }}>Ya tengo una cuenta</Button></form> : <form className="grid gap-4" onSubmit={handleLogin}><div><h2 className="font-bold">Inicia sesión</h2><p className="mt-1 text-sm text-slate-600">Usa tus credenciales para consultar o tomar un turno.</p></div><Input placeholder="Usuario" autoComplete="username" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} required /><Input type="password" placeholder="Contraseña" autoComplete="current-password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required /><Button disabled={working} className="bg-[#102b3f]"><LockKeyhole /> Entrar</Button><Button type="button" variant="link" onClick={() => { setError(""); setScreen("register"); }}>Crear una cuenta</Button></form>}
    </section>
  </main>;
  if (!data) return null;

  const isAdmin = data.profile.role === "administrador"; const canManage = data.profile.canManageChargers; const missingProfile = !data.profile.alias || !data.profile.phone; const upcoming = data.queue.filter((turn) => turn.status === "queued").slice(0, 6);
  const myTurnPosition = myTurn ? data.queue.filter((turn) => turn.charger_id === myTurn.charger_id && (turn.scheduled_start < myTurn.scheduled_start || (turn.scheduled_start === myTurn.scheduled_start && turn.id <= myTurn.id))).length : 0;
  const firstQueuedOnMyCharger = myTurn ? data.queue.filter((turn) => turn.charger_id === myTurn.charger_id && turn.status === "queued").sort((first, second) => first.scheduled_start.localeCompare(second.scheduled_start) || first.id - second.id)[0] : undefined;
  const activeOnMyCharger = myTurn ? data.queue.some((turn) => turn.charger_id === myTurn.charger_id && turn.status === "active") : false;
  const canStartMyTurn = Boolean(waitingMine && firstQueuedOnMyCharger?.id === waitingMine.id && !activeOnMyCharger && untilMyTurn !== null && untilMyTurn <= 0);
  return <main className="min-h-screen bg-[#eef5f7] text-[#102b3f]"><header className="border-b border-[#d8e4e8] bg-white/90"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4 sm:px-8"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-[#102b3f] text-[#9ef0bc]"><Bolt className="size-5 fill-current" /></span><div><h1 className="font-bold">Carga en orden</h1><p className="text-xs text-slate-500">Sesiones de 2 horas · 5 min de transición</p></div></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={enableAlerts}><Bell /> Avisos</Button>{isAdmin && <Button variant="outline" size="sm" onClick={() => setAdminOpen(true)}><Users /> <span className="hidden sm:inline">Usuarios</span></Button>}<Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogTrigger asChild><Button variant="outline" size="sm"><UserRound /> <span className="hidden sm:inline">{data.profile.alias || "Perfil"}</span></Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Mi perfil</DialogTitle><DialogDescription>La aplicación solo almacena alias y teléfono.</DialogDescription></DialogHeader><div className="grid gap-4"><Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Alias" /><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono" /><Button disabled={working} onClick={async () => { await send({ action: "profile", alias, phone, notificationChannel: "app" }); setProfileOpen(false); }}>Guardar cambios</Button></div></DialogContent></Dialog><Button variant="ghost" size="icon" aria-label="Cerrar sesión" onClick={signOut}><LogOut /></Button></div></div></header>
    <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">{error && <div role="alert" className="mb-5 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><XCircle className="size-4" />{error}</div>}{missingProfile && <div className="mb-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">Completa tu alias y teléfono antes de tomar un turno.</div>}
      <section className="grid gap-5 lg:grid-cols-[1.6fr_.8fr]">
        <div className="rounded-3xl bg-[#102b3f] p-6 text-white shadow-[0_18px_40px_rgba(16,43,63,.18)] sm:p-8">
          <div className="flex items-start justify-between">
            <div><p className="text-sm font-semibold text-[#9ef0bc]">MI SESIÓN</p><h2 className="mt-2 text-2xl font-bold">{activeMine ? "Estás cargando" : myTurn ? "Tu turno está apartado" : "Elige un cargador"}</h2></div>
            <Clock3 className="size-8 text-[#9ef0bc]" />
          </div>
          {activeMine ? <div className="mt-7 grid gap-5 sm:grid-cols-2"><div><p className="text-sm text-slate-300">{activeMine.charger_code} · {activeMine.location}</p><p className={"mt-1 text-5xl font-bold " + (remaining !== null && remaining <= 0 ? "text-rose-300" : "")}>{remaining !== null && remaining <= 0 ? Math.abs(remaining) + " min extra" : remaining + " min"}</p></div><Button disabled={working} className="self-end bg-[#9ef0bc] text-[#102b3f] hover:bg-[#b9f5d0]" onClick={() => send({ action: "finish", queueId: activeMine.id })}><CheckCircle2 /> Ya desconecté</Button></div> : myTurn ? <div className="mt-6"><p className="text-sm text-slate-300">{myTurn.charger_code} · {myTurn.location}</p><p className="mt-1 text-3xl font-bold">{formatDate(myTurn.scheduled_start)}</p><p className="mt-2 text-sm text-slate-300">Posición en la fila: {myTurnPosition}. {myTurnPosition === 1 ? "Eres la siguiente persona." : "Hay " + (myTurnPosition - 1) + " turnos antes del tuyo."}</p>{untilMyTurn !== null && untilMyTurn <= 15 && <p className="mt-3 rounded-xl bg-[#27536c] px-3 py-2 text-sm font-semibold text-[#c8f7d7]">{untilMyTurn <= 0 ? "Tu turno ya está disponible. Puedes conectarte." : "Prepárate: te toca en " + untilMyTurn + " min."}</p>}<p className="mt-3 text-sm text-slate-300">{canStartMyTurn ? "Ya puedes marcar que conectaste." : activeOnMyCharger ? "El cargador sigue en uso; te avisaremos al acercarse tu turno." : untilMyTurn !== null && untilMyTurn > 5 ? "Podrás marcar conexión cuando concluya el margen de transición de 5 minutos." : "Aún hay turnos antes del tuyo."}</p><div className="mt-5 flex flex-wrap gap-3"><Button disabled={working || !canStartMyTurn} className="bg-[#9ef0bc] text-[#102b3f] hover:bg-[#b9f5d0]" onClick={() => send({ action: "start", queueId: myTurn.id })}><Bolt /> Marcar conectado</Button><Button disabled={working} variant="outline" className="border-slate-500 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => send({ action: "cancel", queueId: myTurn.id })}>Cancelar</Button></div></div> : <p className="mt-7 text-sm text-slate-300">Elige un cargador o fórmate en una fila. Cada carga reserva 120 minutos y 5 minutos de transición.</p>}
        </div>
        <aside className="rounded-3xl border border-[#d8e4e8] bg-white p-6 shadow-sm"><p className="text-sm font-semibold text-[#2e7585]">TU ACCESO</p><h2 className="mt-2 text-xl font-bold">{roleLabel[data.profile.role]}</h2><p className="mt-3 text-sm leading-6 text-slate-600">{canManage ? "Tienes permiso específico para administrar cargadores." : data.profile.role === "coordinador" ? "Puedes supervisar turnos; no tienes gestión de cargadores." : "Puedes reservar y gestionar tus propios turnos."}</p></aside>
      </section>
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div><p className="text-sm font-semibold text-[#2e7585]">DISPONIBILIDAD EN VIVO</p><h2 className="text-2xl font-bold">Cargadores</h2></div>
          {canManage && <Dialog open={chargerOpen} onOpenChange={setChargerOpen}><DialogTrigger asChild><Button className="bg-[#102b3f]"><Plus /> Agregar cargador</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Nuevo cargador</DialogTitle><DialogDescription>La gestión de cargadores está separada del rol de coordinación.</DialogDescription></DialogHeader><div className="grid gap-4"><Input value={chargerCode} onChange={(e) => setChargerCode(e.target.value)} placeholder="Código, por ejemplo EV-01" /><Input value={chargerLocation} onChange={(e) => setChargerLocation(e.target.value)} placeholder="Ubicación" /><Select value={chargerAccess} onValueChange={(value) => setChargerAccess(value as "usuario" | "coordinador")}><SelectTrigger className="w-full"><SelectValue placeholder="Acceso" /></SelectTrigger><SelectContent><SelectItem value="usuario">Todo el personal</SelectItem><SelectItem value="coordinador">Solo coordinación</SelectItem></SelectContent></Select><Button disabled={working} onClick={async () => { await send({ action: "add-charger", code: chargerCode, location: chargerLocation, accessLevel: chargerAccess }); setChargerCode(""); setChargerLocation(""); setChargerOpen(false); }}>Guardar cargador</Button></div></DialogContent></Dialog>}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.chargers.map((charger) => {
            const locked = charger.access_level === "coordinador" && data.profile.role === "usuario";
            const chargerTurns = data.queue.filter((turn) => turn.charger_id === charger.id).sort((first, second) => first.scheduled_start.localeCompare(second.scheduled_start) || first.id - second.id);
            const activeTurn = chargerTurns.find((turn) => turn.status === "active");
            const queuedTurns = chargerTurns.filter((turn) => turn.status === "queued");
            const nextQueued = queuedTurns[0];
            const myTurnHere = myTurn?.charger_id === charger.id;
            return <article key={charger.id} className="rounded-2xl border border-[#d8e4e8] bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{charger.code}</p><p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><MapPin className="size-3.5" />{charger.location}</p></div><span className={"rounded-full px-2.5 py-1 text-xs font-semibold " + (!activeTurn && queuedTurns.length === 0 ? "bg-emerald-100 text-emerald-800" : activeTurn ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700")}>{!activeTurn && queuedTurns.length === 0 ? "Disponible" : activeTurn ? "En carga" : "En fila"}</span></div><div className="mt-5 border-t border-slate-100 pt-4">{activeTurn ? <p className="text-sm text-slate-600">{"Cargando: " + (activeTurn.alias || "Sin alias")}</p> : nextQueued ? <p className="text-sm text-slate-600">{"Siguiente: " + (nextQueued.alias || "Sin alias")}</p> : <p className="text-sm text-slate-600">Sin sesión activa.</p>}{queuedTurns.length > 0 && <p className="mt-2 text-sm font-medium text-[#2e7585]">{queuedTurns.length + " " + (queuedTurns.length === 1 ? "persona en la fila" : "personas en la fila")}</p>}<div className="mt-4 flex flex-wrap gap-2">{!myTurn ? <Button size="sm" disabled={working || locked || missingProfile} onClick={() => send({ action: "join", chargerId: charger.id })}>{locked ? <><Crown /> Solo coordinación</> : chargerTurns.length > 0 ? <><Users /> Formarme en fila</> : <><Bolt /> Apartar 2 horas</>}</Button> : myTurnHere ? <p className="text-sm font-medium text-[#2e7585]">{activeMine ? "Estás usando este cargador." : "Tu turno está en esta fila."}</p> : null}{canManage && <Button size="sm" variant="ghost" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800" disabled={working || chargerTurns.length > 0} onClick={() => send({ action: "archive-charger", chargerId: charger.id })}>Retirar</Button>}</div></div></article>;
          })}
          {data.chargers.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-[#b9cbd2] bg-white p-8 text-center text-slate-600">Aún no hay cargadores registrados.</div>}
        </div>
      </section>
      <section className="mt-9 rounded-3xl border border-[#d8e4e8] bg-white p-6 shadow-sm"><h2 className="text-xl font-bold">Próximos turnos</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-slate-500"><tr><th className="pb-3">Horario</th><th className="pb-3">Cargador</th><th className="pb-3">Ubicación</th><th className="pb-3">Alias</th></tr></thead><tbody>{upcoming.length ? upcoming.map((turn) => <tr key={turn.id} className="border-b border-slate-50"><td className="py-3">{formatDate(turn.scheduled_start)}</td><td className="py-3">{turn.charger_code}</td><td className="py-3 text-slate-600">{turn.location}</td><td className="py-3">{turn.alias || "Pendiente"}</td></tr>) : <tr><td colSpan={4} className="py-8 text-center text-slate-500">No hay turnos próximos.</td></tr>}</tbody></table></div></section>
      <Dialog open={adminOpen} onOpenChange={(open) => { setAdminOpen(open); if (!open) setEditing(undefined); }}><DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Administración de usuarios</DialogTitle><DialogDescription>Solo administradores pueden crear cuentas, asignar roles y otorgar gestión de cargadores.</DialogDescription></DialogHeader>{editing !== undefined ? <div className="grid gap-4"><div className="flex items-center justify-between"><h3 className="font-semibold">{editing ? `Editar ${editing.username}` : "Nueva cuenta"}</h3><Button variant="ghost" size="sm" onClick={() => setEditing(undefined)}>Volver</Button></div>{editing === null && <Input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} placeholder="Usuario" autoComplete="off" />}<Input value={userForm.alias} onChange={(e) => setUserForm({ ...userForm, alias: e.target.value })} placeholder="Alias" /><Input value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} placeholder="Teléfono" /><Select value={userForm.role} onValueChange={(value) => setUserForm({ ...userForm, role: value as Role, canManageChargers: value === "administrador" ? true : userForm.canManageChargers })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="usuario">Usuario</SelectItem><SelectItem value="coordinador">Coordinador</SelectItem><SelectItem value="administrador">Administrador</SelectItem></SelectContent></Select><Input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} placeholder={editing ? "Nueva contraseña (opcional)" : "Contraseña (mínimo 12 caracteres)"} autoComplete="new-password" /><Input type="password" value={userForm.confirm} onChange={(e) => setUserForm({ ...userForm, confirm: e.target.value })} placeholder="Confirma la contraseña" autoComplete="new-password" /><label className="flex items-center gap-3 text-sm"><Checkbox checked={userForm.canManageChargers || userForm.role === "administrador"} disabled={userForm.role === "administrador"} onCheckedChange={(checked) => setUserForm({ ...userForm, canManageChargers: checked === true })} />Puede administrar cargadores</label>{editing && <label className="flex items-center gap-3 text-sm"><Checkbox checked={userForm.active} onCheckedChange={(checked) => setUserForm({ ...userForm, active: checked === true })} />Cuenta activa</label>}<Button disabled={working} onClick={saveUser}><ShieldCheck /> Guardar cuenta</Button></div> : <div><div className="mb-4 flex justify-end"><Button size="sm" onClick={() => openUser()}><Plus /> Nuevo usuario</Button></div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="pb-3">Usuario</th><th className="pb-3">Alias</th><th className="pb-3">Rol</th><th className="pb-3">Permiso</th><th className="pb-3">Estado</th><th className="pb-3"></th></tr></thead><tbody>{data.users.map((user) => <tr key={user.id} className="border-b border-slate-100"><td className="py-3 font-medium">{user.username}</td><td className="py-3">{user.alias}</td><td className="py-3">{roleLabel[user.role]}</td><td className="py-3">{user.role === "administrador" || user.can_manage_chargers ? "Cargadores" : "—"}</td><td className="py-3">{user.is_active ? "Activo" : "Inactivo"}</td><td className="py-3 text-right"><Button size="sm" variant="outline" onClick={() => openUser(user)}><Settings2 /> Editar</Button></td></tr>)}</tbody></table></div></div>}</DialogContent></Dialog>
    </div></main>;
}
