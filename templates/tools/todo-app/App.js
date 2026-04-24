import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar, SafeAreaView, Platform, Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Constants ────────────────────────────────────────────────
const LISTS = [
  { id: 'all', label: 'All', icon: '📋' },
  { id: 'personal', label: 'Personal', icon: '🏠' },
  { id: 'work', label: 'Work', icon: '💼' },
  { id: 'shopping', label: 'Shopping', icon: '🛒' },
];

const PRIORITIES = [
  { id: 'high', label: 'High', color: '#EF4444' },
  { id: 'medium', label: 'Medium', color: '#F59E0B' },
  { id: 'low', label: 'Low', color: '#6B7280' },
];

const FILTERS = ['all', 'active', 'completed'];

const SAMPLE_TASKS = [
  { id: '1', title: 'Buy groceries', list: 'shopping', priority: 'medium', done: false },
  { id: '2', title: 'Finish project proposal', list: 'work', priority: 'high', done: false },
  { id: '3', title: 'Call the dentist', list: 'personal', priority: 'low', done: true },
  { id: '4', title: 'Review PR from Marcus', list: 'work', priority: 'high', done: false },
  { id: '5', title: 'Pick up dry cleaning', list: 'personal', priority: 'medium', done: false },
  { id: '6', title: 'Get coffee beans', list: 'shopping', priority: 'low', done: true },
  { id: '7', title: 'Update portfolio site', list: 'work', priority: 'medium', done: false },
  { id: '8', title: 'Organize desk', list: 'personal', priority: 'low', done: false },
];

// ── Mouse drag scroll for web ────────────────────────────────
function useDragScroll(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el || Platform.OS !== 'web') return;
    // On web, ScrollView renders a nested div with overflow — find it
    const scrollEl = el.querySelector ? el : el.getScrollableNode?.() || el;
    const target = scrollEl.querySelector ? scrollEl.querySelector('[data-testid], [class]')?.parentElement || scrollEl : scrollEl;
    let isDown = false, startX = 0, scrollLeft = 0;
    const onDown = (e) => { isDown = true; startX = e.pageX; scrollLeft = target.scrollLeft; target.style.cursor = 'grabbing'; };
    const onUp = () => { isDown = false; target.style.cursor = 'grab'; };
    const onMove = (e) => { if (!isDown) return; e.preventDefault(); target.scrollLeft = scrollLeft - (e.pageX - startX); };
    target.style.cursor = 'grab';
    target.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    return () => { target.removeEventListener('mousedown', onDown); window.removeEventListener('mouseup', onUp); window.removeEventListener('mousemove', onMove); };
  }, [ref]);
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [tasks, setTasks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [activeList, setActiveList] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newList, setNewList] = useState('personal');
  const [newPriority, setNewPriority] = useState('medium');
  const listTabsRef = useRef(null);
  useDragScroll(listTabsRef);

  // Load / Save
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem('todo-tasks');
        setTasks(saved ? JSON.parse(saved) : SAMPLE_TASKS);
      } catch {
        setTasks(SAMPLE_TASKS);
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded) {
      AsyncStorage.setItem('todo-tasks', JSON.stringify(tasks)).catch(() => {});
    }
  }, [tasks, loaded]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    let list = tasks;
    if (activeList !== 'all') list = list.filter((t) => t.list === activeList);
    if (statusFilter === 'active') list = list.filter((t) => !t.done);
    if (statusFilter === 'completed') list = list.filter((t) => t.done);
    return list;
  }, [tasks, activeList, statusFilter]);

  // Stats
  const stats = useMemo(() => {
    const filtered = activeList === 'all' ? tasks : tasks.filter((t) => t.list === activeList);
    const total = filtered.length;
    const done = filtered.filter((t) => t.done).length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, active: total - done, percent };
  }, [tasks, activeList]);

  // List counts
  const listCounts = useMemo(() => {
    const counts = { all: tasks.filter((t) => !t.done).length };
    LISTS.forEach((l) => {
      if (l.id !== 'all') counts[l.id] = tasks.filter((t) => t.list === l.id && !t.done).length;
    });
    return counts;
  }, [tasks]);

  // Actions
  const addTask = () => {
    if (!newTitle.trim()) return;
    const task = {
      id: Date.now().toString(),
      title: newTitle.trim(),
      list: newList,
      priority: newPriority,
      done: false,
    };
    setTasks((prev) => [task, ...prev]);
    setNewTitle('');
    setShowAdd(false);
  };

  const toggleTask = (id) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  };

  const deleteTask = (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0F" />
      <View style={s.container}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>✅ My Tasks</Text>
            <Text style={s.subtitle}>{stats.active} remaining · {stats.done} done</Text>
          </View>
          <TouchableOpacity style={s.addBtn} onPress={() => setShowAdd(!showAdd)}>
            <Text style={s.addBtnText}>{showAdd ? '✕' : '+'}</Text>
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        <View style={s.progressWrap}>
          <View style={s.progressBg}>
            <View style={[s.progressFill, { width: `${stats.percent}%` }]} />
          </View>
          <Text style={s.progressText}>{stats.percent}%</Text>
        </View>

        {/* Add task modal */}
        <Modal visible={showAdd} transparent animationType="slide">
          <View style={s.modalOverlay}>
            <View style={s.addForm}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>New Task</Text>
                <TouchableOpacity onPress={() => setShowAdd(false)}>
                  <Text style={s.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={s.input}
                placeholder="What needs to be done?"
                placeholderTextColor="#5C5C72"
                value={newTitle}
                onChangeText={setNewTitle}
                onSubmitEditing={addTask}
                autoFocus
              />
              <View style={s.formRow}>
                <Text style={s.formLabel}>List</Text>
                <View style={s.chipRow}>
                  {LISTS.filter((l) => l.id !== 'all').map((l) => (
                    <TouchableOpacity
                      key={l.id}
                      style={[s.chip, newList === l.id && s.chipActive]}
                      onPress={() => setNewList(l.id)}
                    >
                      <Text style={[s.chipText, newList === l.id && s.chipTextActive]}>
                        {l.icon} {l.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={s.formRow}>
                <Text style={s.formLabel}>Priority</Text>
                <View style={s.chipRow}>
                  {PRIORITIES.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={[s.chip, newPriority === p.id && { borderColor: p.color, backgroundColor: p.color + '15' }]}
                      onPress={() => setNewPriority(p.id)}
                    >
                      <Text style={[s.chipText, newPriority === p.id && { color: p.color }]}>
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <TouchableOpacity
                style={[s.submitBtn, !newTitle.trim() && s.submitBtnDisabled]}
                onPress={addTask}
                disabled={!newTitle.trim()}
              >
                <Text style={s.submitBtnText}>Add Task</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* List tabs */}
        <View ref={listTabsRef}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.listTabs} contentContainerStyle={{ paddingRight: 20 }}>
            {LISTS.map((l) => (
              <TouchableOpacity
                key={l.id}
                style={[s.listTab, activeList === l.id && s.listTabActive]}
                onPress={() => setActiveList(l.id)}
              >
                <Text style={[s.listTabText, activeList === l.id && s.listTabTextActive]}>
                  {l.icon} {l.label}
                </Text>
                {listCounts[l.id] > 0 && (
                  <View style={[s.listBadge, activeList === l.id && s.listBadgeActive]}>
                    <Text style={[s.listBadgeText, activeList === l.id && s.listBadgeTextActive]}>
                      {listCounts[l.id]}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Status filter */}
        <View style={s.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              style={[s.filterBtn, statusFilter === f && s.filterBtnActive]}
              onPress={() => setStatusFilter(f)}
            >
              <Text style={[s.filterText, statusFilter === f && s.filterTextActive]}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Task list */}
        <ScrollView style={s.taskList} showsVerticalScrollIndicator={false}>
          {filteredTasks.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyText}>
                {statusFilter === 'completed' ? 'No completed tasks' : 'No tasks here yet'}
              </Text>
            </View>
          )}
          {filteredTasks.map((task) => {
            const pri = PRIORITIES.find((p) => p.id === task.priority);
            const list = LISTS.find((l) => l.id === task.list);
            return (
              <View key={task.id} style={[s.taskRow, task.done && s.taskDone]}>
                <TouchableOpacity
                  style={[s.checkbox, task.done && s.checkboxDone]}
                  onPress={() => toggleTask(task.id)}
                >
                  {task.done && <Text style={s.checkmark}>✓</Text>}
                </TouchableOpacity>
                <View style={s.taskInfo}>
                  <Text style={[s.taskTitle, task.done && s.taskTitleDone]}>{task.title}</Text>
                  <View style={s.taskMeta}>
                    <View style={[s.priDot, { backgroundColor: pri.color }]} />
                    <Text style={s.taskMetaText}>{pri.label}</Text>
                    <Text style={s.taskMetaDivider}>·</Text>
                    <Text style={s.taskMetaText}>{list?.icon} {list?.label}</Text>
                  </View>
                </View>
                <TouchableOpacity style={s.deleteBtn} onPress={() => deleteTask(task.id)}>
                  <Text style={s.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0F' },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 40 : 10 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#F0F0F5', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#5C5C72', marginTop: 2 },
  addBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: '#6366F1',
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 22, fontWeight: '600' },

  // Progress
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  progressBg: { flex: 1, height: 6, backgroundColor: '#1E1E2E', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#10B981', borderRadius: 3 },
  progressText: { fontSize: 12, fontWeight: '700', color: '#5C5C72', width: 36, textAlign: 'right' },

  // Add form
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  addForm: {
    backgroundColor: '#1A1A24', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderColor: '#1E1E2E', borderBottomWidth: 0,
    padding: 20, paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#F0F0F5' },
  modalClose: { fontSize: 18, color: '#5C5C72', padding: 4 },
  input: {
    backgroundColor: '#111118', borderWidth: 1, borderColor: '#1E1E2E', borderRadius: 8,
    padding: 12, fontSize: 15, color: '#F0F0F5', marginBottom: 12,
  },
  formRow: { marginBottom: 12 },
  formLabel: { fontSize: 12, fontWeight: '600', color: '#9898AC', marginBottom: 6 },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#1E1E2E', backgroundColor: '#111118',
  },
  chipActive: { borderColor: '#6366F1', backgroundColor: 'rgba(99,102,241,0.12)' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#9898AC' },
  chipTextActive: { color: '#6366F1' },
  submitBtn: {
    backgroundColor: '#6366F1', borderRadius: 8, paddingVertical: 12,
    alignItems: 'center', marginTop: 4,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // List tabs
  listTabs: { flexGrow: 0, marginBottom: 12 },
  listTab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8,
    backgroundColor: '#1A1A24', borderWidth: 1, borderColor: '#1E1E2E', marginRight: 6,
  },
  listTabActive: { borderColor: 'rgba(99,102,241,0.3)', backgroundColor: 'rgba(99,102,241,0.1)' },
  listTabText: { fontSize: 13, fontWeight: '600', color: '#9898AC' },
  listTabTextActive: { color: '#6366F1' },
  listBadge: {
    backgroundColor: '#1E1E2E', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1,
  },
  listBadgeActive: { backgroundColor: 'rgba(99,102,241,0.2)' },
  listBadgeText: { fontSize: 10, fontWeight: '700', color: '#5C5C72' },
  listBadgeTextActive: { color: '#6366F1' },

  // Filter
  filterRow: { flexDirection: 'row', gap: 4, marginBottom: 14 },
  filterBtn: {
    paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6,
    borderWidth: 1, borderColor: '#1E1E2E',
  },
  filterBtnActive: { borderColor: 'rgba(99,102,241,0.3)', backgroundColor: 'rgba(99,102,241,0.1)' },
  filterText: { fontSize: 12, fontWeight: '600', color: '#5C5C72' },
  filterTextActive: { color: '#6366F1' },

  // Tasks
  taskList: { flex: 1 },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: '#1E1E2E',
  },
  taskDone: { opacity: 0.45 },
  checkbox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: '#2E2E42',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxDone: { borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.15)' },
  checkmark: { fontSize: 13, color: '#10B981', fontWeight: '700' },
  taskInfo: { flex: 1 },
  taskTitle: { fontSize: 14, fontWeight: '600', color: '#F0F0F5' },
  taskTitleDone: { textDecorationLine: 'line-through', color: '#5C5C72' },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  priDot: { width: 6, height: 6, borderRadius: 3 },
  taskMetaText: { fontSize: 11, color: '#5C5C72' },
  taskMetaDivider: { fontSize: 11, color: '#2E2E42' },
  deleteBtn: { padding: 6 },
  deleteBtnText: { fontSize: 14, color: '#5C5C72' },

  // Empty
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: '#5C5C72' },
});