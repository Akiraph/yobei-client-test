import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import {
  accountMatches,
  deleteItem,
  itemContentFor,
  lock,
  runSync,
  saveAccountCredential,
  saveItem,
  selectedItem,
  selectedItemContent,
  selectItem,
  setActiveNav,
  setSearch,
  state,
  toggleSettings,
  visibleItems,
} from '../../lib/store';
import { errorMessage } from '../../lib/errors';
import { inTauri, markActivity } from '../../lib/ipc';
import { notifyError } from '../../lib/notify';
import { createMediaQuery } from '../../shared/useMediaQuery';

type Pane = 'list' | 'detail';
type EditState = { mode: 'new' } | { mode: 'edit'; id: string } | null;

export function createVaultFeature() {
  const isMobile = createMediaQuery('(max-width: 859px)');
  const [pane, setPane] = createSignal<Pane>('list');
  const [editing, setEditing] = createSignal<EditState>(null);
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [scanning, setScanning] = createSignal(false);
  let closingSidebarViaHistory = false;

  createEffect(() => {
    if (!isMobile()) setSidebarOpen(false);
  });

  onMount(() => {
    const onPopState = () => {
      if (!isMobile()) return;
      if (closingSidebarViaHistory) {
        closingSidebarViaHistory = false;
        return;
      }
      if (sidebarOpen()) {
        setSidebarOpen(false);
        return;
      }
      if (pane() === 'detail') resetDetail();
    };
    window.addEventListener('popstate', onPopState);
    onCleanup(() => window.removeEventListener('popstate', onPopState));

    if (!inTauri) return;
    let lastActivity = 0;
    const ping = () => {
      const now = Date.now();
      if (now - lastActivity < 5000) return;
      lastActivity = now;
      void markActivity().catch(() => {});
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'scroll'];
    events.forEach((event) => window.addEventListener(event, ping, { passive: true }));
    onCleanup(() => events.forEach((event) => window.removeEventListener(event, ping)));
  });

  function resetDetail() {
    setPane('list');
    selectItem(null);
    setEditing(null);
  }

  function showDetail() {
    if (pane() === 'detail') return;
    setPane('detail');
    if (isMobile() && history.state?.yobei !== 'detail') {
      history.pushState({ ...(history.state ?? {}), yobei: 'detail' }, '');
    }
  }

  function back() {
    const shouldPopDetail = isMobile() && history.state?.yobei === 'detail';
    resetDetail();
    if (shouldPopDetail) {
      history.back();
    }
  }

  function selectVaultItem(id: string) {
    selectItem(id);
    if (isMobile()) showDetail();
  }

  function createNew() {
    selectItem(null);
    setEditing({ mode: 'new' });
    if (isMobile()) showDetail();
  }

  async function edit(id: string) {
    if (isMobile()) showDetail();
    if (state.selectedItemId !== id) selectItem(id);
    await itemContentFor(id).catch(() => {});
    setEditing({ mode: 'edit', id });
  }

  async function remove(id: string) {
    try {
      await deleteItem(id);
    } catch (error) {
      notifyError(errorMessage(error));
      return;
    }
    setEditing(null);
    if (isMobile()) back();
  }

  function closeEditor() {
    const current = editing();
    if (isMobile() && current?.mode === 'new') {
      back();
      return;
    }
    setEditing(null);
  }

  function openSidebar() {
    if (!isMobile() || sidebarOpen()) return;
    setSidebarOpen(true);
    if (history.state?.yobei !== 'sidebar') {
      history.pushState({ ...(history.state ?? {}), yobei: 'sidebar' }, '');
    }
  }

  function closeSidebar() {
    if (!sidebarOpen()) return;
    if (isMobile() && history.state?.yobei === 'sidebar') {
      closingSidebarViaHistory = true;
      setSidebarOpen(false);
      history.back();
      return;
    }
    setSidebarOpen(false);
  }

  function closeSettings() {
    toggleSettings(false);
  }

  function navigate(id: string) {
    toggleSettings(false);
    setActiveNav(id);
  }

  function openSettings() {
    toggleSettings(true);
  }

  function openScan() {
    setScanning(true);
  }

  function closeScan() {
    setScanning(false);
  }

  return {
    isMobile,
    items: () => state.items,
    search: () => state.search,
    sync: () => state.sync,
    selectedItemId: () => state.selectedItemId,
    activeNav: () => state.activeNav,
    visibleItems,
    selectedItem,
    selectedItemContent,
    setSearch,
    itemContentFor,
    accountMatches,
    saveItem,
    saveAccountCredential,
    runSync,
    navigate,
    openSettings,
    scanning,
    openScan,
    closeScan,
    lock,
    pane,
    editing,
    editingItem: () => {
      const current = editing();
      if (current?.mode !== 'edit') return null;
      const item = state.items.find((value) => value.id === current.id);
      return item ? { ...item, ...state.itemContent[item.id] } : null;
    },
    sidebarOpen,
    settingsOpen: () => state.showSettings,
    condensing: () => state.condensing,
    select: selectVaultItem,
    back,
    createNew,
    edit,
    remove,
    closeEditor,
    openSidebar,
    closeSidebar,
    closeSettings,
  };
}

export type VaultFeature = ReturnType<typeof createVaultFeature>;
