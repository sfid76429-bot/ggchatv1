import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FormEvent, ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Compass,
  Hash,
  LogOut,
  LockKeyhole,
  Menu,
  MessageCircle,
  Plus,
  Radio,
  Search,
  Send,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  getDiscoverGroupsQueryKey,
  getGetCommunitySummaryQueryKey,
  getGetCurrentUserQueryKey,
  getHealthCheckQueryKey,
  getListGroupMessagesQueryKey,
  getListMyGroupsQueryKey,
  setBaseUrl,
  useCreateGroup,
  useDiscoverGroups,
  useGetCommunitySummary,
  useGetCurrentUser,
  useHealthCheck,
  useJoinGroup,
  useListGroupMessages,
  useListMyGroups,
  useLogIn,
  useLogOut,
  useSendGroupMessage,
  useSignUp,
} from '@workspace/api-client-react';
import type { ChatMessage, GroupSummary, UserProfile } from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 12_000, refetchOnWindowFocus: false },
  },
});

const apiServicePrefix = import.meta.env.DEV ? '/guild-api' : '';
setBaseUrl(apiServicePrefix || null);

type AppState = {
  user?: UserProfile;
  userLoading: boolean;
  groups: GroupSummary[];
  groupsLoading: boolean;
  groupsError: boolean;
  discovery: GroupSummary[];
  discoveryLoading: boolean;
  discoveryError: boolean;
  summary?: { groupCount: number; memberCount: number; activeGroupCount: number };
  summaryLoading: boolean;
  summaryError: boolean;
  health?: { status: string };
  queryClient: QueryClient;
};

const AppContext = createContext<AppState | null>(null);
const messageLimit = 100;

function useAppState() {
  const state = useContext(AppContext);
  if (!state) throw new Error('Guild Chat app context is missing.');
  return state;
}

function errorText(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

function formatCount(value: number) {
  return new Intl.NumberFormat('en', { notation: value > 9999 ? 'compact' : 'standard' }).format(value);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'G';
}

function upsertMessage(messages: ChatMessage[] = [], message: ChatMessage) {
  const found = messages.some((item) => item.id === message.id);
  return [...(found ? messages.filter((item) => item.id !== message.id) : messages), message]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function GuildChatApp() {
  const currentUser = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const user = currentUser.data;
  const summary = useGetCommunitySummary();
  const health = useHealthCheck({ query: { retry: false, queryKey: getHealthCheckQueryKey() } });
  const mine = useListMyGroups({
    query: { enabled: Boolean(user), queryKey: getListMyGroupsQueryKey() },
  });
  const discovery = useDiscoverGroups(undefined, {
    query: { queryKey: getDiscoverGroupsQueryKey() },
  });
  const state = useMemo<AppState>(() => ({
    user,
    userLoading: currentUser.isLoading,
    groups: mine.data ?? [],
    groupsLoading: mine.isLoading,
    groupsError: Boolean(mine.error),
    discovery: discovery.data ?? [],
    discoveryLoading: discovery.isLoading,
    discoveryError: Boolean(discovery.error),
    summary: summary.data,
    summaryLoading: summary.isLoading,
    summaryError: Boolean(summary.error),
    health: health.data,
    queryClient,
  }), [
    user, currentUser.isLoading, mine.data, mine.isLoading, mine.error,
    discovery.data, discovery.isLoading, discovery.error,
    summary.data, summary.isLoading, summary.error, health.data,
  ]);

  return (
    <AppContext.Provider value={state}>
      <AppFrame />
    </AppContext.Provider>
  );
}

function AppFrame() {
  const state = useAppState();
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const logout = useLogOut();
  const client = useQueryClient();

  useEffect(() => setMobileMenuOpen(false), [location]);

  const doLogout = () => {
    logout.mutate(undefined, {
      onSuccess: async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: getGetCurrentUserQueryKey(), refetchType: 'none' }),
          client.invalidateQueries({ queryKey: getListMyGroupsQueryKey(), refetchType: 'none' }),
          client.invalidateQueries({ queryKey: getGetCommunitySummaryQueryKey(), refetchType: 'none' }),
          client.invalidateQueries({ queryKey: getDiscoverGroupsQueryKey(), refetchType: 'none' }),
        ]);
        client.removeQueries({ queryKey: getGetCurrentUserQueryKey() });
        client.removeQueries({ queryKey: getListMyGroupsQueryKey() });
        setLocation('/');
      },
    });
  };

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`} aria-label="Main navigation">
        <div className="brand-row">
          <Link href="/" className="brand-lockup" data-testid="link-brand-home" aria-label="Guild Chat home">
            <span className="brand-mark"><span /></span>
            <span className="brand-name">guild<span>chat</span></span>
          </Link>
          <button
            className="icon-button sidebar-close"
            aria-label="Close navigation"
            data-testid="button-close-navigation"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="side-nav">
          <p className="side-label">Explore</p>
          <Link href="/" className={`side-link ${location === '/' ? 'side-link-active' : ''}`} data-testid="link-welcome">
            <span className="side-link-icon"><Compass size={17} /></span>
            <span>Welcome</span>
          </Link>
          <Link href="/discover" className={`side-link ${location === '/discover' ? 'side-link-active' : ''}`} data-testid="link-discover">
            <span className="side-link-icon"><Search size={17} /></span>
            <span>Discover groups</span>
            <ArrowUpRight className="side-link-trail" size={14} />
          </Link>

          <div className="side-section-heading">
            <p className="side-label">Your groups</p>
            {state.user && (
              <Link href="/discover" className="side-add" aria-label="Find a group" data-testid="link-find-group">
                <Plus size={15} />
              </Link>
            )}
          </div>
          {!state.user && !state.userLoading && (
            <div className="sidebar-note" data-testid="text-sidebar-signin-prompt">
              Sign in to keep your groups close.
            </div>
          )}
          {state.user && state.groupsLoading && (
            <div className="side-skeleton-list" aria-label="Loading your groups" data-testid="loading-sidebar-groups">
              <span /><span /><span />
            </div>
          )}
          {state.user && !state.groupsLoading && state.groupsError && (
            <div className="sidebar-note sidebar-note-error" role="status" data-testid="status-sidebar-groups-error">
              Groups could not load.
            </div>
          )}
          {state.user && !state.groupsLoading && !state.groupsError && state.groups.length === 0 && (
            <div className="sidebar-note" data-testid="empty-sidebar-groups">
              No groups yet. Find a corner of the internet that feels like yours.
            </div>
          )}
          {state.user && state.groups.slice(0, 8).map((group) => (
            <Link
              href={`/groups/${group.id}`}
              className={`side-group ${location === `/groups/${group.id}` ? 'side-group-active' : ''}`}
              key={group.id}
              data-testid={`link-sidebar-group-${group.id}`}
            >
              <span className="group-glyph">{group.name.slice(0, 1).toUpperCase()}</span>
              <span className="side-group-name">{group.name}</span>
              {group.activeCount > 0 && <span className="side-live-dot" aria-label={`${group.activeCount} active`} />}
            </Link>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-rule" />
          {state.user ? (
            <div className="sidebar-profile" data-testid="profile-sidebar-current-user">
              <span className="avatar avatar-small">{initials(state.user.displayName)}</span>
              <span className="profile-copy">
                <strong>{state.user.displayName}</strong>
                <span>@{state.user.handle}</span>
              </span>
              <button
                className="icon-button logout-button"
                aria-label="Sign out"
                data-testid="button-sign-out"
                onClick={doLogout}
                disabled={logout.isPending}
                title={logout.isPending ? 'Signing out' : 'Sign out'}
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <Link className="sidebar-signin" href="/sign-in" data-testid="link-sidebar-sign-in">
              <LockKeyhole size={16} /> Sign in
            </Link>
          )}
          {logout.error && <p className="sidebar-error" role="alert" data-testid="status-sign-out-error">{errorText(logout.error)}</p>}
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <button
            className="icon-button mobile-menu-button"
            aria-label="Open navigation"
            aria-expanded={mobileMenuOpen}
            data-testid="button-open-navigation"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span className="breadcrumb-mark" />
            <span>{location.startsWith('/groups/') ? 'Inside a group' : location === '/discover' ? 'The directory' : location.startsWith('/sign-') ? 'Your account' : 'A place to belong'}</span>
          </div>
          <div className="topbar-actions">
            {state.user ? (
              <span className="signed-in-caption"><span className="presence-dot" /> Signed in as <strong>@{state.user.handle}</strong></span>
            ) : (
              <>
                <Link href="/sign-in" className="topbar-signin" data-testid="link-topbar-sign-in">Sign in</Link>
                <Link href="/sign-up" className="button button-small button-primary" data-testid="link-topbar-sign-up">Make an account <ArrowRight size={14} /></Link>
              </>
            )}
          </div>
        </header>

        <main className="page-content">
          <Switch>
            <Route path="/" component={WelcomePage} />
            <Route path="/sign-in" component={SignInPage} />
            <Route path="/sign-up" component={SignUpPage} />
            <Route path="/discover" component={DiscoverPage} />
            <Route path="/groups/:id" component={GroupPage} />
            <Route component={NotFoundPage} />
          </Switch>
        </main>
      </div>
      {mobileMenuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} data-testid="button-navigation-scrim" />}
    </div>
  );
}

function GroupCard({ group, compact = false }: { group: GroupSummary; compact?: boolean }) {
  const [, setLocation] = useLocation();
  return (
    <article className={`group-card ${compact ? 'group-card-compact' : ''}`} data-testid={`card-group-${group.id}`}>
      <div className="group-card-top">
        <span className="group-emblem">{group.name.slice(0, 1).toUpperCase()}</span>
        <span className="category-chip" data-testid={`text-category-${group.id}`}>{group.category}</span>
        {group.activeCount > 0 && <span className="active-chip"><span className="presence-dot" /> {formatCount(group.activeCount)} active</span>}
      </div>
      <Link href={`/groups/${group.id}`} className="group-card-title-link" data-testid={`link-group-${group.id}`}>
        <h3 data-testid={`text-group-name-${group.id}`}>{group.name}</h3>
        <ChevronRight size={16} />
      </Link>
      <p className="group-description" data-testid={`text-group-description-${group.id}`}>{group.description}</p>
      {!compact && group.lastMessage && (
        <p className="group-last-message" data-testid={`text-group-last-message-${group.id}`}>
          <MessageCircle size={13} /> {group.lastMessage}
        </p>
      )}
      <div className="group-card-bottom">
        <span className="member-count" data-testid={`text-member-count-${group.id}`}><Users size={14} /> {formatCount(group.memberCount)} members</span>
        <button
          className="text-action"
          type="button"
          onClick={() => setLocation(`/groups/${group.id}`)}
          data-testid={`button-open-group-${group.id}`}
        >
          {group.isMember ? 'Open group' : 'View group'} <ArrowUpRight size={14} />
        </button>
      </div>
    </article>
  );
}

function WelcomePage() {
  const state = useAppState();
  return (
    <div className="welcome-page page-enter">
      <section className="welcome-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> GROUPS, NOT INBOXES</div>
          <h1>Good conversations<br />have a <em>place.</em></h1>
          <p className="hero-subtitle">Find your people. Join the groups that make you curious. Talk where you belong.</p>
          <div className="hero-actions">
            <Link href="/discover" className="button button-primary" data-testid="link-hero-discover">Explore groups <ArrowRight size={16} /></Link>
            {!state.user && <Link href="/sign-up" className="button button-quiet" data-testid="link-hero-sign-up">Create your account <ArrowUpRight size={15} /></Link>}
          </div>
          <div className="hero-footnote"><ShieldCheck size={14} /> Conversations stay inside the groups you join.</div>
        </div>
        <div className="hero-art" aria-label="Guild Chat group community overview">
          <div className="art-paper-grid" />
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-core"><span className="art-core-mark"><i /><i /><i /></span></div>
          <div className="art-node art-node-one"><span className="art-node-dot" /><div><strong>Shared interests</strong><small>start with what you love</small></div></div>
          <div className="art-node art-node-two"><span className="art-node-dot" /><div><strong>Good conversation</strong><small>make room to connect</small></div></div>
          <div className="art-node art-node-three"><span className="art-node-dot" /><div><strong>People, together</strong><small>find your place here</small></div></div>
          <div className="art-caption"><span>01 / 03</span><span>COMMUNITY, IN ITS ELEMENT</span></div>
        </div>
      </section>

      <section className="community-strip" aria-label="Guild Chat community statistics">
        <div className="strip-intro">
          <span className="strip-kicker">THE COMMUNITY, RIGHT NOW</span>
          <p>Real groups. Real people.<br />No made-up activity.</p>
        </div>
        <div className="strip-stat">
          <span className="stat-value" data-testid="text-summary-groups">
            {state.summaryLoading ? <span className="stat-skeleton" /> : state.summaryError ? '—' : formatCount(state.summary?.groupCount ?? 0)}
          </span>
          <span className="stat-label">groups to explore</span>
        </div>
        <div className="strip-stat">
          <span className="stat-value" data-testid="text-summary-members">
            {state.summaryLoading ? <span className="stat-skeleton" /> : state.summaryError ? '—' : formatCount(state.summary?.memberCount ?? 0)}
          </span>
          <span className="stat-label">members in the mix</span>
        </div>
        <div className="strip-stat strip-stat-last">
          <span className="stat-value stat-live" data-testid="text-summary-active-groups">
            {state.summaryLoading ? <span className="stat-skeleton" /> : state.summaryError ? '—' : formatCount(state.summary?.activeGroupCount ?? 0)}
          </span>
          <span className="stat-label"><span className="presence-dot" /> active groups</span>
        </div>
        {state.summaryError && <p className="inline-error summary-error" role="status" data-testid="status-summary-error">Community totals are temporarily unavailable.</p>}
      </section>

      <section className="popular-section">
        <div className="section-heading">
          <div>
            <span className="section-overline">A GOOD PLACE TO START</span>
            <h2>Groups with a pulse</h2>
          </div>
          <Link href="/discover" className="subtle-link" data-testid="link-popular-all">See all groups <ArrowRight size={15} /></Link>
        </div>
        {state.discoveryLoading ? <GroupGridSkeleton count={3} /> : state.discoveryError ? (
          <RetryState message="Popular groups could not load." onRetry={() => { void state.queryClient.invalidateQueries({ queryKey: getDiscoverGroupsQueryKey() }); }} />
        ) : state.discovery.length === 0 ? (
          <EmptyState title="The directory is quiet for a moment." body="Try again soon, or come back when the first groups arrive." testId="empty-home-groups" />
        ) : (
          <div className="group-grid home-group-grid">
            {state.discovery.slice(0, 3).map((group) => <GroupCard group={group} compact key={group.id} />)}
          </div>
        )}
      </section>

      <section className="belong-callout">
        <div className="callout-index">A BETTER WAY TO GATHER</div>
        <div className="callout-copy">
          <h2>Less noise.<br /><em>More signal.</em></h2>
          <p>Guild Chat is built around the communities you choose. Join a group, get to know the room, and keep the conversation in context.</p>
        </div>
        <div className="callout-right">
          <div className="callout-line" />
          <p><span>01</span> Find the room</p>
          <p><span>02</span> Meet the regulars</p>
          <p><span>03</span> Make it yours</p>
          <Link href="/discover" className="button button-light" data-testid="link-callout-discover">Find your group <ArrowRight size={15} /></Link>
        </div>
      </section>
      <footer className="page-footer">
        <span className="footer-brand"><span className="brand-mark brand-mark-small"><span /></span> guildchat</span>
        <span>{state.health?.status === 'ok' ? 'All systems in good shape' : 'A quieter corner of the internet'}</span>
        <span className="footer-note"><span className="presence-dot" /> Conversations are group-only</span>
      </footer>
    </div>
  );
}

function GroupGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="group-grid" aria-label="Loading groups" data-testid="loading-group-grid">
      {Array.from({ length: count }, (_, index) => (
        <div className="group-card skeleton-card" key={index}>
          <span className="skeleton skeleton-short" /><span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-copy" /><span className="skeleton skeleton-copy skeleton-copy-short" />
          <span className="skeleton skeleton-foot" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body, testId }: { title: string; body: string; testId: string }) {
  return (
    <div className="empty-state" data-testid={testId}>
      <div className="empty-symbol"><Compass size={22} /></div>
      <div><h3>{title}</h3><p>{body}</p></div>
    </div>
  );
}

function RetryState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-state" role="alert" data-testid="status-retry-error">
      <p>{message}</p>
      <button className="button button-quiet button-small" onClick={onRetry} data-testid="button-retry">Try again <ArrowRight size={14} /></button>
    </div>
  );
}

function SignInPage() {
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const login = useLogIn();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    login.mutate({ data: { handle: handle.trim().replace(/^@/, ''), password } }, {
      onSuccess: (result) => {
        client.setQueryData(getGetCurrentUserQueryKey(), result.user);
        void Promise.all([
          client.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }),
          client.invalidateQueries({ queryKey: getListMyGroupsQueryKey() }),
          client.invalidateQueries({ queryKey: getGetCommunitySummaryQueryKey() }),
          client.invalidateQueries({ queryKey: getDiscoverGroupsQueryKey() }),
        ]);
        setLocation('/discover');
      },
    });
  };
  return (
    <AuthLayout
      eyebrow="WELCOME BACK"
      title={<>The room<br /><em>is yours.</em></>}
      description="Sign in to pick up where your groups left off."
      footer={<>New around here? <Link href="/sign-up" data-testid="link-to-sign-up">Create an account <ArrowRight size={14} /></Link></>}
    >
      <form className="auth-form" onSubmit={submit} data-testid="form-sign-in">
        <div className="auth-form-heading"><span className="form-step">01 — YOUR ACCOUNT</span><h2>Sign in</h2></div>
        <label className="field-label" htmlFor="signin-handle">Handle</label>
        <div className="input-wrap input-handle"><span className="input-prefix">@</span><input id="signin-handle" autoComplete="username" value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="yourhandle" minLength={3} maxLength={24} required data-testid="input-sign-in-handle" /></div>
        <div className="field-label-row"><label className="field-label" htmlFor="signin-password">Password</label></div>
        <div className="input-wrap">
          <input id="signin-password" type={visible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" minLength={1} maxLength={128} required data-testid="input-sign-in-password" />
          <button className="input-action" type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? 'Hide password' : 'Show password'} data-testid="button-toggle-sign-in-password">{visible ? 'Hide' : 'Show'}</button>
        </div>
        {login.error && <p className="form-error" role="alert" data-testid="status-sign-in-error">{errorText(login.error, 'That handle and password did not match.')}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={login.isPending} data-testid="button-submit-sign-in">
          {login.isPending ? <><span className="button-spinner" /> Signing you in</> : <>Sign in <ArrowRight size={16} /></>}
        </button>
        <p className="auth-privacy"><LockKeyhole size={14} /> Your account opens the groups you belong to.</p>
      </form>
    </AuthLayout>
  );
}

function SignUpPage() {
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const signup = useSignUp();
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const handleValid = /^[a-zA-Z0-9_]{3,24}$/.test(handle.trim().replace(/^@/, ''));
  const strength = [
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;
  const passwordStrong = strength === 4;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!handleValid || !passwordStrong) return;
    signup.mutate({ data: { handle: handle.trim().replace(/^@/, ''), displayName: displayName.trim(), password } }, {
      onSuccess: (result) => {
        client.setQueryData(getGetCurrentUserQueryKey(), result.user);
        void Promise.all([
          client.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }),
          client.invalidateQueries({ queryKey: getListMyGroupsQueryKey() }),
          client.invalidateQueries({ queryKey: getGetCommunitySummaryQueryKey() }),
          client.invalidateQueries({ queryKey: getDiscoverGroupsQueryKey() }),
        ]);
        setLocation('/discover');
      },
    });
  };
  return (
    <AuthLayout
      eyebrow="MAKE YOURSELF AT HOME"
      title={<>Find your<br /><em>people.</em></>}
      description="One handle, a few good groups, and a lot more room to talk."
      footer={<>Already have an account? <Link href="/sign-in" data-testid="link-to-sign-in">Sign in <ArrowRight size={14} /></Link></>}
    >
      <form className="auth-form signup-form" onSubmit={submit} data-testid="form-sign-up">
        <div className="auth-form-heading"><span className="form-step">01 — A NAME FOR THE ROOM</span><h2>Create your account</h2></div>
        <label className="field-label" htmlFor="signup-handle">Unique handle</label>
        <div className="input-wrap input-handle"><span className="input-prefix">@</span><input id="signup-handle" value={handle} onChange={(event) => setHandle(event.target.value.replace(/^@/, ''))} autoComplete="username" placeholder="yourhandle" minLength={3} maxLength={24} required aria-describedby="handle-hint" data-testid="input-sign-up-handle" /></div>
        <p id="handle-hint" className={`field-hint ${handle && !handleValid ? 'field-hint-error' : ''}`} data-testid="status-handle-guidance">
          {handle && !handleValid ? 'Use 3–24 letters, numbers, or underscores.' : '3–24 letters, numbers, or underscores.'}
        </p>
        <label className="field-label" htmlFor="signup-display-name">Display name</label>
        <div className="input-wrap"><input id="signup-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="What people call you" minLength={1} maxLength={40} required data-testid="input-sign-up-display-name" /></div>
        <label className="field-label" htmlFor="signup-password">Strong password</label>
        <div className="input-wrap">
          <input id="signup-password" type={visible ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="At least 12 characters" minLength={12} maxLength={128} required aria-describedby="password-strength" data-testid="input-sign-up-password" />
          <button className="input-action" type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? 'Hide password' : 'Show password'} data-testid="button-toggle-sign-up-password">{visible ? 'Hide' : 'Show'}</button>
        </div>
        <div className="password-strength" id="password-strength" data-testid="status-password-strength">
          <div className="strength-bars" aria-hidden="true">{[0, 1, 2, 3].map((item) => <span className={strength > item ? 'strength-filled' : ''} key={item} />)}</div>
          <span>{password ? (passwordStrong ? 'Strong enough to go' : '12+ characters, upper, lower, number and symbol') : 'Use a password only you know'}</span>
        </div>
        {signup.error && <p className="form-error" role="alert" data-testid="status-sign-up-error">{errorText(signup.error, 'That handle may already be in use.')}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={signup.isPending || !handleValid || !passwordStrong || !displayName.trim()} data-testid="button-submit-sign-up">
          {signup.isPending ? <><span className="button-spinner" /> Creating your account</> : <>Create account <ArrowRight size={16} /></>}
        </button>
        <p className="auth-privacy"><ShieldCheck size={14} /> Your handle is unique. Your conversations stay in groups.</p>
      </form>
    </AuthLayout>
  );
}

function AuthLayout({ eyebrow, title, description, footer, children }: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="auth-page page-enter">
      <section className="auth-story">
        <span className="eyebrow"><span className="eyebrow-line" /> {eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="auth-orbit-art" aria-hidden="true">
          <div className="auth-ring auth-ring-one" /><div className="auth-ring auth-ring-two" /><div className="auth-ring auth-ring-three" />
          <span className="auth-orbit-center"><span className="brand-mark"><span /></span></span>
          <span className="auth-orbit-point point-one" /><span className="auth-orbit-point point-two" /><span className="auth-orbit-point point-three" />
        </div>
        <div className="auth-story-foot"><span>THE INTERNET IS BETTER IN GOOD COMPANY</span><span>G / C</span></div>
      </section>
      <section className="auth-panel">
        {children}
        <p className="auth-switch">{footer}</p>
      </section>
    </div>
  );
}

function DiscoverPage() {
  const state = useAppState();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const params = search.trim() ? { search: search.trim() } : undefined;
  const groupsQuery = useDiscoverGroups(params, { query: { queryKey: getDiscoverGroupsQueryKey(params) } });
  const join = useJoinGroup();
  const create = useCreateGroup();

  const invalidateGroups = () => Promise.all([
    client.invalidateQueries({ queryKey: getListMyGroupsQueryKey() }),
    client.invalidateQueries({ queryKey: getGetCommunitySummaryQueryKey() }),
    client.invalidateQueries({ queryKey: getDiscoverGroupsQueryKey() }),
  ]);

  const joinGroup = (group: GroupSummary) => {
    if (!state.user) {
      setLocation('/sign-in');
      return;
    }
    join.mutate({ data: { groupId: group.id } }, {
      onSuccess: (result) => {
        void invalidateGroups();
        setLocation(`/groups/${result.id}`);
      },
    });
  };
  const createGroup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!state.user) {
      setLocation('/sign-in');
      return;
    }
    create.mutate({ data: { name: name.trim(), description: description.trim(), category: category.trim() } }, {
      onSuccess: (group) => {
        void invalidateGroups();
        setCreateOpen(false);
        setLocation(`/groups/${group.id}`);
      },
    });
  };
  const groups = groupsQuery.data ?? [];

  return (
    <div className="discover-page page-enter">
      <div className="page-title-row discover-title-row">
        <div>
          <span className="section-overline">THE GROUP DIRECTORY</span>
          <h1>Find your <em>corner.</em></h1>
          <p>Active communities, led by the people who make them.</p>
        </div>
        <button className="button button-outline" type="button" onClick={() => {
          if (!state.user) setLocation('/sign-in');
          else setCreateOpen((value) => !value);
        }} data-testid="button-toggle-create-group">
          {createOpen ? <X size={16} /> : <Plus size={16} />} {createOpen ? 'Close form' : 'Start a group'}
        </button>
      </div>

      {createOpen && (
        <section className="create-group-panel" aria-labelledby="create-group-title" data-testid="panel-create-group">
          <div className="create-panel-copy">
            <span className="section-overline">SET THE TABLE</span>
            <h2 id="create-group-title">Start with a name.</h2>
            <p>Your group is a place for people to return to. Keep the invitation clear.</p>
          </div>
          <form className="create-group-form" onSubmit={createGroup} data-testid="form-create-group">
            <label className="field-label" htmlFor="group-name">Group name</label>
            <input id="group-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={48} placeholder="A name people remember" required data-testid="input-create-group-name" />
            <label className="field-label" htmlFor="group-description">Description</label>
            <textarea id="group-description" value={description} onChange={(event) => setDescription(event.target.value)} minLength={1} maxLength={180} placeholder="What brings people together here?" rows={3} required data-testid="input-create-group-description" />
            <label className="field-label" htmlFor="group-category">Category</label>
            <input id="group-category" value={category} onChange={(event) => setCategory(event.target.value)} minLength={1} maxLength={32} placeholder="For example, design or reading" required data-testid="input-create-group-category" />
            {create.error && <p className="form-error" role="alert" data-testid="status-create-group-error">{errorText(create.error)}</p>}
            <button className="button button-primary" type="submit" disabled={create.isPending || !state.user} data-testid="button-submit-create-group">
              {create.isPending ? <><span className="button-spinner" /> Starting group</> : <>Create group <ArrowRight size={15} /></>}
            </button>
          </form>
        </section>
      )}

      <div className="directory-toolbar">
        <label className="search-box" htmlFor="group-search">
          <Search size={18} />
          <input id="group-search" type="search" value={search} onChange={(event) => setSearch(event.target.value.slice(0, 80))} placeholder="Search groups, interests, ideas…" maxLength={80} data-testid="input-search-groups" />
          {search && <button className="search-clear" aria-label="Clear search" onClick={() => setSearch('')} data-testid="button-clear-search"><X size={15} /></button>}
        </label>
        <div className="directory-result-label" data-testid="text-directory-status">
          {groupsQuery.isLoading ? 'Finding groups' : `${formatCount(groups.length)} ${groups.length === 1 ? 'group' : 'groups'}`}
          <span className="directory-live"><span className="presence-dot" /> ranked by activity</span>
        </div>
      </div>

      {join.error && <p className="form-error global-form-error" role="alert" data-testid="status-join-error">{errorText(join.error, 'Could not join this group.')}</p>}
      {groupsQuery.isLoading ? <GroupGridSkeleton count={6} /> : groupsQuery.error ? (
        <RetryState message="We could not load the group directory." onRetry={() => { void groupsQuery.refetch(); }} />
      ) : groups.length === 0 ? (
        <div className="directory-empty" data-testid="empty-discover-groups">
          <EmptyState
            title={search ? `Nothing matched “${search}”.` : 'No groups to show just yet.'}
            body={search ? 'Try a broader term, or search for a different interest.' : 'Check back soon. New communities will appear here.'}
            testId="empty-directory-state"
          />
          {search && <button className="text-action" onClick={() => setSearch('')} data-testid="button-reset-search">Clear search <X size={14} /></button>}
        </div>
      ) : (
        <div className="group-grid directory-grid" data-testid="grid-discover-groups">
          {groups.map((group) => (
            <article className="group-card directory-group-card" data-testid={`card-discover-group-${group.id}`} key={group.id}>
              <div className="group-card-top">
                <span className="group-emblem">{group.name.slice(0, 1).toUpperCase()}</span>
                <span className="category-chip">{group.category}</span>
                {group.activeCount > 0 && <span className="active-chip"><span className="presence-dot" /> {formatCount(group.activeCount)} active</span>}
              </div>
              <Link href={`/groups/${group.id}`} className="group-card-title-link" data-testid={`link-discover-group-${group.id}`}>
                <h2>{group.name}</h2><ChevronRight size={16} />
              </Link>
              <p className="group-description">{group.description}</p>
              <div className="group-meta-row">
                <span><Users size={14} /> {formatCount(group.memberCount)} members</span>
                {group.lastMessage && <span className="group-activity"><Activity size={13} /> {group.lastMessage}</span>}
              </div>
              {group.isMember ? (
                <Link className="button button-member" href={`/groups/${group.id}`} data-testid={`button-enter-group-${group.id}`}>
                  <Check size={15} /> You're a member <ArrowRight size={14} />
                </Link>
              ) : (
                <button
                  className="button button-join"
                  onClick={() => joinGroup(group)}
                  disabled={join.isPending}
                  data-testid={`button-join-group-${group.id}`}
                >
                  {join.isPending && join.variables?.data.groupId === group.id ? <><span className="button-spinner" /> Joining</> : <>Join group <Plus size={15} /></>}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      <div className="directory-footnote"><Radio size={14} /> Group activity is provided by the community, not a popularity score.</div>
    </div>
  );
}

function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const state = useAppState();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const groupId = id ?? '';
  const group = state.groups.find((item) => item.id === groupId)
    ?? state.discovery.find((item) => item.id === groupId);
  const isMember = Boolean(state.user && group?.isMember);
  const messageParams = useMemo(() => ({ groupId, limit: messageLimit }), [groupId]);
  const messageQueryKey = useMemo(() => getListGroupMessagesQueryKey(messageParams), [messageParams]);
  const messagesQuery = useListGroupMessages(messageParams, {
    query: { enabled: Boolean(groupId && isMember), queryKey: messageQueryKey, retry: false },
  });
  const join = useJoinGroup();
  const send = useSendGroupMessage();
  const [draft, setDraft] = useState('');
  const [socketState, setSocketState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [sendError, setSendError] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const pendingId = useRef<string | null>(null);
  const messages = messagesQuery.data ?? [];

  useEffect(() => {
    if (!groupId || !isMember) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let attempts = 0;
    const connect = () => {
      if (stopped) return;
      setSocketState(attempts === 0 ? 'connecting' : 'reconnecting');
      const url = new URL(`${apiServicePrefix}/api/groups/ws`, window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('groupId', groupId);
      socket = new WebSocket(url);
      socket.onopen = () => {
        const reconnected = attempts > 0;
        attempts = 0;
        setSocketState('connected');
        if (reconnected) {
          void client.invalidateQueries({ queryKey: messageQueryKey });
        }
      };
      socket.onmessage = (event) => {
        try {
          const parsed: unknown = JSON.parse(String(event.data));
          if (!parsed || typeof parsed !== 'object') return;
          const envelope = parsed as { message?: unknown; data?: unknown };
          const raw = (envelope.message ?? envelope.data ?? parsed) as Partial<ChatMessage>;
          if (
            typeof raw.id === 'string' &&
            typeof raw.groupId === 'string' &&
            typeof raw.content === 'string' &&
            typeof raw.createdAt === 'string' &&
            typeof raw.userId === 'string' &&
            typeof raw.handle === 'string' &&
            typeof raw.displayName === 'string' &&
            raw.groupId === groupId
          ) {
            client.setQueryData<ChatMessage[]>(messageQueryKey, (current) => upsertMessage(current, raw as ChatMessage));
          }
        } catch {
          // Ignore non-message frames; the HTTP history remains the source of truth.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setSocketState('reconnecting');
        attempts += 1;
        const delay = Math.min(900 * (2 ** Math.min(attempts - 1, 5)), 25_000);
        retryTimer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [groupId, isMember, client, messageQueryKey]);

  useEffect(() => {
    const frame = feedRef.current;
    if (frame) frame.scrollTop = frame.scrollHeight;
  }, [messages.length, groupId]);

  const joinGroup = () => {
    if (!state.user) {
      setLocation('/sign-in');
      return;
    }
    join.mutate({ data: { groupId } }, {
      onSuccess: (result) => {
        void Promise.all([
          client.invalidateQueries({ queryKey: getListMyGroupsQueryKey() }),
          client.invalidateQueries({ queryKey: getGetCommunitySummaryQueryKey() }),
          client.invalidateQueries({ queryKey: getDiscoverGroupsQueryKey() }),
        ]);
        client.setQueryData(getDiscoverGroupsQueryKey(), (current: GroupSummary[] | undefined) =>
          current?.map((item) => item.id === result.id ? result : item));
      },
    });
  };

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !state.user || !group || !isMember || send.isPending) return;
    setSendError('');
    const optimisticId = `pending-${Date.now()}`;
    pendingId.current = optimisticId;
    const optimistic: ChatMessage = {
      id: optimisticId,
      groupId,
      userId: state.user.id,
      handle: state.user.handle,
      displayName: state.user.displayName,
      content,
      createdAt: new Date().toISOString(),
    };
    client.setQueryData<ChatMessage[]>(messageQueryKey, (current) => upsertMessage(current, optimistic));
    setDraft('');
    send.mutate({ data: { groupId, content } }, {
      onSuccess: (message) => {
        const optimisticMessageId = pendingId.current;
        client.setQueryData<ChatMessage[]>(messageQueryKey, (current = []) => {
          const withoutPending = optimisticMessageId ? current.filter((item) => item.id !== optimisticMessageId) : current;
          return upsertMessage(withoutPending, message);
        });
        pendingId.current = null;
        void client.invalidateQueries({ queryKey: getListGroupMessagesQueryKey(messageParams) });
      },
      onError: (error) => {
        const optimisticMessageId = pendingId.current;
        client.setQueryData<ChatMessage[]>(messageQueryKey, (current = []) =>
          optimisticMessageId ? current.filter((item) => item.id !== optimisticMessageId) : current);
        pendingId.current = null;
        setDraft(content);
        setSendError(errorText(error, 'Your message was not sent. Try again.'));
      },
    });
  };

  if (state.userLoading || state.groupsLoading || state.discoveryLoading) {
    return <div className="room-loading page-enter"><span className="skeleton skeleton-title" /><span className="skeleton skeleton-copy" /><span className="skeleton skeleton-room" /><p>Finding your group…</p></div>;
  }

  if (!group) {
    return (
      <div className="room-not-found page-enter" data-testid="status-group-not-found">
        <div className="empty-symbol"><Hash size={22} /></div>
        <span className="section-overline">NO SUCH ROOM</span>
        <h1>We couldn't find that group.</h1>
        <p>It may no longer be available, or the address may have changed.</p>
        <Link href="/discover" className="button button-primary" data-testid="link-group-not-found-discover">Back to discovery <ArrowRight size={15} /></Link>
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="group-preview page-enter" data-testid={`panel-group-preview-${group.id}`}>
        <Link href="/discover" className="back-link" data-testid="link-back-discover"><ArrowDownRight size={15} /> All groups</Link>
        <div className="preview-hero">
          <div className="preview-emblem">{group.name.slice(0, 1).toUpperCase()}</div>
          <span className="category-chip">{group.category}</span>
          <h1>{group.name}</h1>
          <p>{group.description}</p>
          <div className="preview-numbers">
            <span><Users size={15} /> <strong>{formatCount(group.memberCount)}</strong> members</span>
            <span><span className="presence-dot" /> <strong>{formatCount(group.activeCount)}</strong> active now</span>
          </div>
          {join.error && <p className="form-error" role="alert" data-testid="status-group-join-error">{errorText(join.error, 'Could not join this group.')}</p>}
          <button className="button button-primary" onClick={joinGroup} disabled={join.isPending} data-testid={`button-group-preview-join-${group.id}`}>
            {join.isPending ? <><span className="button-spinner" /> Joining group</> : <>Join this group <ArrowRight size={15} /></>}
          </button>
        </div>
        <div className="preview-private-note"><LockKeyhole size={16} /><span><strong>Conversation starts after you join.</strong><br />Group messages and the composer are only available to members.</span></div>
      </div>
    );
  }

  return (
    <div className="room-page page-enter" data-testid={`room-${group.id}`}>
      <div className="room-header">
        <div className="room-title">
          <span className="room-hash"><Hash size={20} /></span>
          <div><span className="section-overline">{group.category} GROUP</span><h1 data-testid={`text-room-name-${group.id}`}>{group.name}</h1></div>
        </div>
        <div className="room-header-info">
          <span className={`socket-status socket-${socketState}`} data-testid="status-room-connection">
            <span className="presence-dot" />
            {socketState === 'connected' ? 'Live' : socketState === 'connecting' ? 'Connecting' : 'Reconnecting'}
          </span>
          <span className="room-member-count"><Users size={15} /> {formatCount(group.memberCount)}</span>
        </div>
      </div>
      <div className="room-description"><p>{group.description}</p><span><span className="presence-dot" /> {formatCount(group.activeCount)} active now</span></div>

      <section className="chat-panel" aria-label={`${group.name} group chat`}>
        <div className="chat-stream" ref={feedRef} data-testid="list-group-messages" aria-live="polite">
          <div className="room-welcome">
            <span className="welcome-hash"><Hash size={18} /></span>
            <span className="section-overline">THE START OF THE ROOM</span>
            <h2>You're in <em>{group.name}.</em></h2>
            <p>This is where the group happens. Say hello when you're ready.</p>
          </div>
          {messagesQuery.isLoading && (
            <div className="message-skeletons" aria-label="Loading messages" data-testid="loading-group-messages">
              <span /><span /><span />
            </div>
          )}
          {messagesQuery.error && (
            <div className="chat-error" role="alert" data-testid="status-messages-error">
              <p>Messages could not load.</p><button className="text-action" onClick={() => { void messagesQuery.refetch(); }} data-testid="button-retry-messages">Try again <ArrowRight size={14} /></button>
            </div>
          )}
          {!messagesQuery.isLoading && !messagesQuery.error && messages.length === 0 && (
            <div className="chat-empty" data-testid="empty-group-messages">
              <span className="empty-rule" /><p>No messages here yet. Make the first one count.</p>
            </div>
          )}
          {!messagesQuery.error && messages.map((message) => (
            <article className={`message-row ${message.userId === state.user?.id ? 'message-own' : ''}`} key={message.id} data-testid={`message-${message.id}`}>
              <span className="avatar message-avatar">{initials(message.displayName)}</span>
              <div className="message-content">
                <div className="message-meta">
                  <strong data-testid={`text-message-author-${message.id}`}>{message.displayName}</strong>
                  <span>@{message.handle}</span>
                  <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                  {message.id.startsWith('pending-') && <span className="pending-label">Sending</span>}
                </div>
                <p data-testid={`text-message-content-${message.id}`}>{message.content}</p>
              </div>
            </article>
          ))}
        </div>
        <form className="composer" onSubmit={submitMessage} data-testid="form-send-message">
          {sendError && <p className="form-error composer-error" role="alert" data-testid="status-send-message-error">{sendError}</p>}
          <label className="sr-only" htmlFor="message-composer">Message {group.name}</label>
          <span className="composer-avatar avatar avatar-small">{initials(state.user?.displayName ?? '')}</span>
          <input
            id="message-composer"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
            placeholder={`Write to ${group.name}…`}
            maxLength={2000}
            autoComplete="off"
            disabled={send.isPending || !state.user}
            data-testid="input-message-composer"
          />
          <span className="composer-count" aria-live="polite" data-testid="text-message-length">{draft.length > 1800 ? `${draft.length}/2000` : ''}</span>
          <button className="composer-send" type="submit" aria-label="Send message" disabled={!draft.trim() || send.isPending} data-testid="button-send-message">
            {send.isPending ? <span className="button-spinner" /> : <Send size={17} />}
          </button>
        </form>
      </section>
      <div className="room-footer-note"><LockKeyhole size={13} /> Only members of {group.name} can read or write here.</div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <section className="not-found-page page-enter" data-testid="page-not-found">
      <span className="not-found-number">404</span>
      <span className="section-overline">WRONG TURN</span>
      <h1>This isn't a room.</h1>
      <p>The page you are looking for does not exist, or has moved somewhere else.</p>
      <div className="not-found-actions">
        <Link href="/" className="button button-primary" data-testid="link-not-found-home">Go home <ArrowRight size={15} /></Link>
        <Link href="/discover" className="button button-quiet" data-testid="link-not-found-discover">Discover groups <Compass size={15} /></Link>
      </div>
    </section>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GuildChatApp />
    </QueryClientProvider>
  );
}

export default App;