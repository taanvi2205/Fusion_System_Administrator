/* eslint-disable react/prop-types */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box,
  Paper,
  Title,
  Text,
  Button,
  Badge,
  Table,
  ScrollArea,
  Flex,
  Tooltip,
  Loader,
  Center,
  Modal,
  Divider,
  ActionIcon,
  Group,
  Timeline,
  ThemeIcon,
  Alert,
} from "@mantine/core";
import {
  FaTrash,
  FaUpload,
  FaDatabase,
  FaSync,
  FaCheckCircle,
  FaTimesCircle,
  FaHistory,
  FaExclamationTriangle,
} from "react-icons/fa";
import { showNotification } from "@mantine/notifications";
import {
  fetchDatabases,
  fetchBackups,
  createBackup,
  deleteBackup as apiDeleteBackup,
  restoreBackup as apiRestoreBackup,
  getBackupStatus,
  fetchRestores,
  getRestoreStatus,
} from "../../api/Backups";

// ── helpers ────────────────────────────────────────────────────────────────────

const fmtDate = (iso) => {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    relative: relativeTime(d),
  };
};

const relativeTime = (d) => {
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
};

const fmtBytes = (bytes) => {
  if (!bytes || bytes <= 0) return "—";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + " MB";
  return (bytes / 1e3).toFixed(2) + " KB";
};

const fmtDuration = (ms) => {
  if (!ms || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
};

// ── sub-components ─────────────────────────────────────────────────────────────

const StatusBadge = ({ status }) => {
  if (status === "in_progress")
    return (
      <Group spacing={6}>
        <Loader size={14} color="blue" />
        <Text size="sm" color="blue" fw={500}>
          In progress
        </Text>
      </Group>
    );
  if (status === "success")
    return (
      <Badge color="green" variant="light" radius="sm">
        Successful
      </Badge>
    );
  return (
    <Badge color="red" variant="light" radius="sm">
      Failed
    </Badge>
  );
};

const BackupHeatmap = ({ backups }) => {
  // Take last 90 backups, oldest first
  const grid = React.useMemo(() => {
    const last90 = [...backups].slice(0, 90).reverse();
    // Pad to 90 if fewer than 90
    const padded = Array.from({ length: 90 }, (_, i) => {
      const b = last90[i];
      if (!b) return { status: "none", label: "No backup" };
      const d = new Date(b.created_at);
      const dateStr = d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const timeStr = d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const size = b.size_bytes > 0 ? fmtBytes(b.size_bytes) : null;
      const dur = b.duration_ms > 0 ? fmtDuration(b.duration_ms) : null;
      const label =
        b.status === "success"
          ? `${dateStr} ${timeStr} — ${size ?? "?"}${dur ? `, ${dur}` : ""}`
          : b.status === "failed"
            ? `${dateStr} ${timeStr} — Failed: ${b.error_message || "unknown error"}`
            : `${dateStr} ${timeStr} — In progress`;
      return { status: b.status, label };
    });
    return padded;
  }, [backups]);

  return (
    <Box
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(30, 1fr)",
        gap: 4,
      }}
    >
      {grid.map((cell, i) => (
        <Tooltip
          key={i}
          label={cell.label}
          withArrow
          position="top"
          multiline
          maw={260}
        >
          <Box
            style={{
              aspectRatio: "1 / 1",
              borderRadius: 4,
              backgroundColor:
                cell.status === "success"
                  ? "#2f9e44"
                  : cell.status === "failed"
                    ? "#e03131"
                    : cell.status === "in_progress"
                      ? "#1971c2"
                      : "#343a40",
              cursor: "default",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          />
        </Tooltip>
      ))}
    </Box>
  );
};

// ── main page ──────────────────────────────────────────────────────────────────

const BackupPage = () => {
  const [databases, setDatabases] = useState([]);
  const [selectedDb, setSelectedDb] = useState(null);
  const [backups, setBackups] = useState([]);
  const [restores, setRestores] = useState([]);
  const [loadingDbs, setLoadingDbs] = useState(true);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [loadingRestores, setLoadingRestores] = useState(false);
  const [makingBackup, setMakingBackup] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, id: null });
  const [restoreModal, setRestoreModal] = useState({ open: false, id: null });
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const pollTimerRef = useRef(null);
  const restorePollTimerRef = useRef(null);

  // ── load databases ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingDbs(true);
      try {
        const dbs = await fetchDatabases();
        if (!cancelled) {
          setDatabases(Array.isArray(dbs) ? dbs : []);
          if (dbs.length > 0 && !selectedDb) {
            setSelectedDb(dbs[0].id);
          }
        }
      } catch {
        if (!cancelled) setDatabases([]);
      } finally {
        if (!cancelled) setLoadingDbs(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── load backups when db changes ──
  const loadBackups = useCallback(async () => {
    if (!selectedDb) return;
    setLoadingBackups(true);
    try {
      const data = await fetchBackups(selectedDb);
      setBackups(Array.isArray(data) ? data : []);
    } catch {
      setBackups([]);
    } finally {
      setLoadingBackups(false);
    }
  }, [selectedDb]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  // ── load restores when db changes ──
  const loadRestores = useCallback(async () => {
    if (!selectedDb) return;
    setLoadingRestores(true);
    try {
      const data = await fetchRestores(selectedDb);
      setRestores(Array.isArray(data) ? data : []);
    } catch {
      setRestores([]);
    } finally {
      setLoadingRestores(false);
    }
  }, [selectedDb]);

  useEffect(() => {
    loadRestores();
  }, [loadRestores]);

  // ── poll in-progress restores ──
  useEffect(() => {
    if (restorePollTimerRef.current) {
      clearInterval(restorePollTimerRef.current);
      restorePollTimerRef.current = null;
    }

    const inProgress = restores.filter((r) => r.status === "in_progress");
    if (inProgress.length === 0) return;

    restorePollTimerRef.current = setInterval(async () => {
      let anyChanged = false;
      const updated = [...restores];

      for (const rr of inProgress) {
        try {
          const fresh = await getRestoreStatus(rr.id);
          if (fresh.status !== "in_progress") {
            anyChanged = true;
            const idx = updated.findIndex((r) => r.id === rr.id);
            if (idx !== -1) updated[idx] = fresh;

            if (fresh.status === "success") {
              showNotification({
                title: "Restore complete",
                message: `Database restored successfully in ${fmtDuration(fresh.duration_ms)}.`,
                color: "green",
                position: "top-center",
                autoClose: 8000,
              });
              // reload db info to refresh sidebar stats
              loadBackups();
            } else if (fresh.status === "failed") {
              showNotification({
                title: "Restore failed",
                message: fresh.error_message || "An unknown error occurred.",
                color: "red",
                position: "top-center",
                autoClose: 8000,
              });
            }
          }
        } catch {
          // ignore poll errors
        }
      }

      if (anyChanged) {
        setRestores(updated);
      }
    }, 3000);

    return () => {
      if (restorePollTimerRef.current) {
        clearInterval(restorePollTimerRef.current);
        restorePollTimerRef.current = null;
      }
    };
  }, [restores, loadBackups]);

  // ── poll in-progress backups ──
  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    const inProgress = backups.filter((b) => b.status === "in_progress");
    if (inProgress.length === 0) return;

    pollTimerRef.current = setInterval(async () => {
      let anyChanged = false;
      const updated = [...backups];

      for (const bp of inProgress) {
        try {
          const fresh = await getBackupStatus(bp.id);
          if (fresh.status !== "in_progress") {
            anyChanged = true;
            const idx = updated.findIndex((b) => b.id === bp.id);
            if (idx !== -1) updated[idx] = fresh;

            if (fresh.status === "success") {
              showNotification({
                title: "Backup complete",
                message: `Backup finished in ${fmtDuration(fresh.duration_ms)} — ${fmtBytes(fresh.size_bytes)}`,
                color: "green",
                position: "top-center",
              });
            } else if (fresh.status === "failed") {
              showNotification({
                title: "Backup failed",
                message: fresh.error_message || "An unknown error occurred.",
                color: "red",
                position: "top-center",
              });
            }
          }
        } catch {
          // ignore poll errors
        }
      }

      if (anyChanged) {
        setBackups(updated);
      }
    }, 3000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [backups]);

  // ── actions ──────────────────────────────────────────────────────────────────

  const handleMakeBackup = async () => {
    setMakingBackup(true);
    try {
      const newBackup = await createBackup(selectedDb);
      setBackups((prev) => [newBackup, ...prev]);
      showNotification({
        title: "Backup started",
        message: "A new backup is now in progress.",
        color: "blue",
        position: "top-center",
      });
    } catch (err) {
      showNotification({
        title: "Error",
        message: err.response?.data?.error || "Failed to start backup.",
        color: "red",
        position: "top-center",
      });
    } finally {
      setMakingBackup(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiDeleteBackup(deleteModal.id);
      setBackups((prev) => prev.filter((b) => b.id !== deleteModal.id));
      showNotification({
        title: "Backup deleted",
        message: "The backup has been removed.",
        color: "red",
        position: "top-center",
      });
    } catch (err) {
      showNotification({
        title: "Error",
        message: err.response?.data?.error || "Failed to delete backup.",
        color: "red",
        position: "top-center",
      });
    } finally {
      setDeleting(false);
      setDeleteModal({ open: false, id: null });
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const result = await apiRestoreBackup(restoreModal.id);
      // add the new in_progress restore record to state immediately
      setRestores((prev) => [
        {
          id: result.restore_id,
          db_name: result.db_name,
          source_backup_id: result.backup_id,
          source_backup_created_at: result.source_backup_created_at,
          started_at: result.started_at,
          finished_at: null,
          status: "in_progress",
          duration_ms: 0,
          error_message: "",
        },
        ...prev,
      ]);
      showNotification({
        title: "Restore initiated",
        message:
          "Database restore is in progress. You'll be notified when done.",
        color: "blue",
        position: "top-center",
      });
    } catch (err) {
      showNotification({
        title: "Error",
        message: err.response?.data?.error || "Failed to start restore.",
        color: "red",
        position: "top-center",
      });
    } finally {
      setRestoring(false);
      setRestoreModal({ open: false, id: null });
    }
  };

  // ── render ───────────────────────────────────────────────────────────────────

  if (loadingDbs) {
    return (
      <Center h="60vh">
        <Loader size="lg" color="blue" />
      </Center>
    );
  }

  return (
    <Box p="xl" maw={1100} mx="auto">
      {/* Header */}
      <Flex align="center" justify="space-between" mb="xl" wrap="wrap" gap="md">
        <Flex align="center" gap="sm">
          <FaDatabase size={28} color="#228be6" />
          <Title order={2} style={{ color: "#1c7ed6" }}>
            Database Backups
          </Title>
        </Flex>
      </Flex>

      <Flex gap="xl" align="flex-start" wrap="wrap">
        {/* ── Left panel: database list ── */}
        <Paper
          shadow="md"
          radius="lg"
          p="md"
          withBorder
          style={{ minWidth: 230, flex: "0 0 230px" }}
        >
          <Title order={5} mb="md" color="dimmed">
            Databases
          </Title>

          {databases.length === 0 && (
            <Text size="sm" color="dimmed" ta="center" py="md">
              No databases found.
            </Text>
          )}

          {databases.map((db) => (
            <Paper
              key={db.id}
              radius="md"
              p="sm"
              mb="sm"
              withBorder
              onClick={() => setSelectedDb(db.id)}
              style={{
                cursor: "pointer",
                borderColor:
                  selectedDb === db.id
                    ? "#228be6"
                    : "var(--mantine-color-gray-3)",
                backgroundColor:
                  selectedDb === db.id
                    ? "var(--mantine-color-blue-0)"
                    : undefined,
                transition: "all 0.2s",
              }}
            >
              <Flex justify="space-between" align="flex-start" gap={4}>
                <Text fw={600} size="sm" style={{ lineHeight: 1.3 }}>
                  {db.name}
                </Text>
                <Badge
                  color={db.status === "online" ? "green" : "red"}
                  variant="dot"
                  size="sm"
                  mt={2}
                >
                  {db.status === "online" ? "Online" : "Offline"}
                </Badge>
              </Flex>
              {db.size_bytes && (
                <Text size="xs" color="dimmed" mt={2}>
                  Size: {fmtBytes(db.size_bytes)}
                </Text>
              )}
              <Text size="xs" color="dimmed" mt={2}>
                {db.last_backup_at
                  ? `Last backup ${relativeTime(new Date(db.last_backup_at))}`
                  : "No backups yet"}
              </Text>
              <Text size="xs" color="dimmed">
                {db.backup_count || 0} backup
                {db.backup_count !== 1 ? "s" : ""}
              </Text>
            </Paper>
          ))}
        </Paper>

        {/* ── Right panel ── */}
        <Box style={{ flex: 1, minWidth: 0, maxWidth: "100%" }}>
          {/* Backup Heatmap */}
          <Paper shadow="md" radius="lg" p="lg" withBorder mb="xl">
            <Flex justify="space-between" align="center" mb="xs">
              <Title order={4}>
                Backup History
                <Text span size="xs" color="dimmed" ml="sm">
                  (last {Math.min(backups.length, 90)} backups)
                </Text>
              </Title>
              <Group spacing={6}>
                <Box style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Box
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      backgroundColor: "#2f9e44",
                    }}
                  />
                  <Text size="xs" color="dimmed">
                    Success
                  </Text>
                </Box>
                <Box style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Box
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      backgroundColor: "#e03131",
                    }}
                  />
                  <Text size="xs" color="dimmed">
                    Failed
                  </Text>
                </Box>
                <Box style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Box
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      backgroundColor: "#1971c2",
                    }}
                  />
                  <Text size="xs" color="dimmed">
                    In progress
                  </Text>
                </Box>
                <Box style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Box
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      backgroundColor: "#343a40",
                    }}
                  />
                  <Text size="xs" color="dimmed">
                    No backup
                  </Text>
                </Box>
              </Group>
            </Flex>

            {loadingBackups ? (
              <Center h={60}>
                <Loader size="sm" color="blue" />
              </Center>
            ) : (
              <BackupHeatmap backups={backups} />
            )}
          </Paper>

          {/* Restore Activity Log */}
          <Paper shadow="md" radius="lg" p="lg" withBorder mb="xl">
            <Flex justify="space-between" align="center" mb="md">
              <Flex align="center" gap="sm">
                <FaHistory size={16} color="#228be6" />
                <Title order={4}>Restore History</Title>
              </Flex>
              <Tooltip label="Refresh" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={loadRestores}
                  loading={loadingRestores}
                >
                  <FaSync size={12} />
                </ActionIcon>
              </Tooltip>
            </Flex>

            <Divider mb="md" />

            {loadingRestores ? (
              <Center h={80}>
                <Loader size="sm" color="blue" />
              </Center>
            ) : restores.length === 0 ? (
              <Text size="sm" color="dimmed" ta="center" py="md">
                No restores performed yet.
              </Text>
            ) : (
              <ScrollArea mah={280}>
                <Timeline active={-1} bulletSize={28} lineWidth={2}>
                  {restores.map((r) => {
                    const isOk = r.status === "success";
                    const isFail = r.status === "failed";
                    const isRunning = r.status === "in_progress";
                    const srcDate = r.source_backup_created_at
                      ? fmtDate(r.source_backup_created_at)
                      : null;
                    const startedFmt = fmtDate(r.started_at);

                    return (
                      <Timeline.Item
                        key={r.id}
                        bullet={
                          <ThemeIcon
                            size={22}
                            radius="xl"
                            color={isOk ? "green" : isFail ? "red" : "blue"}
                          >
                            {isRunning ? (
                              <Loader size={12} color="white" />
                            ) : isOk ? (
                              <FaCheckCircle size={11} />
                            ) : (
                              <FaTimesCircle size={11} />
                            )}
                          </ThemeIcon>
                        }
                        title={
                          <Flex align="center" gap={8}>
                            <Text size="sm" fw={600}>
                              {isRunning
                                ? "Restore in progress…"
                                : isOk
                                  ? "Restore successful"
                                  : "Restore failed"}
                            </Text>
                            <Badge
                              size="xs"
                              color={isOk ? "green" : isFail ? "red" : "blue"}
                              variant="light"
                            >
                              {r.status}
                            </Badge>
                          </Flex>
                        }
                      >
                        <Text size="xs" color="dimmed">
                          Started: {startedFmt.date} {startedFmt.time} (
                          {startedFmt.relative})
                        </Text>
                        {srcDate && (
                          <Text size="xs" color="dimmed">
                            Restored from backup: {srcDate.date} {srcDate.time}
                          </Text>
                        )}
                        {!isRunning && r.duration_ms > 0 && (
                          <Text size="xs" color="dimmed">
                            Duration: {fmtDuration(r.duration_ms)}
                          </Text>
                        )}
                        {isFail && r.error_message && (
                          <Alert
                            icon={<FaExclamationTriangle size={12} />}
                            color="red"
                            variant="light"
                            mt={6}
                            p={6}
                            radius="sm"
                          >
                            <Text size="xs">{r.error_message}</Text>
                          </Alert>
                        )}
                      </Timeline.Item>
                    );
                  })}
                </Timeline>
              </ScrollArea>
            )}
          </Paper>

          {/* Backups table */}
          <Paper shadow="md" radius="lg" p="lg" withBorder>
            <Flex
              justify="space-between"
              align="center"
              mb="md"
              wrap="wrap"
              gap="sm"
            >
              <Flex align="center" gap="sm">
                <Title order={4}>Backups</Title>
                <Tooltip label="Refresh" withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={loadBackups}
                    loading={loadingBackups}
                  >
                    <FaSync size={12} />
                  </ActionIcon>
                </Tooltip>
              </Flex>
              <Button
                leftIcon={<FaDatabase size={14} />}
                color="blue"
                radius="md"
                loading={makingBackup}
                onClick={handleMakeBackup}
                disabled={!selectedDb}
              >
                Make backup right now
              </Button>
            </Flex>

            <Divider mb="md" />

            {loadingBackups ? (
              <Center h={200}>
                <Loader size="md" color="blue" />
              </Center>
            ) : (
              <ScrollArea>
                <Table
                  highlightOnHover
                  verticalSpacing="sm"
                  horizontalSpacing="md"
                >
                  <thead>
                    <tr>
                      <th style={{ whiteSpace: "nowrap" }}>Created at</th>
                      <th style={{ whiteSpace: "nowrap" }}>Status</th>
                      <th style={{ whiteSpace: "nowrap" }}>Size</th>
                      <th style={{ whiteSpace: "nowrap" }}>Duration</th>
                      <th style={{ whiteSpace: "nowrap" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backups.length === 0 && (
                      <tr>
                        <td colSpan={5}>
                          <Center py="xl">
                            <Text color="dimmed">
                              No backups yet. Click &quot;Make backup right
                              now&quot; to create one.
                            </Text>
                          </Center>
                        </td>
                      </tr>
                    )}
                    {backups.map((b) => {
                      const { date, time, relative } = fmtDate(b.created_at);
                      return (
                        <tr key={b.id}>
                          <td>
                            <Text size="sm" fw={500}>
                              {date} {time}
                            </Text>
                            <Text size="xs" color="dimmed">
                              ({relative})
                            </Text>
                          </td>
                          <td>
                            <StatusBadge status={b.status} />
                            {b.status === "failed" && b.error_message && (
                              <Tooltip
                                label={b.error_message}
                                withArrow
                                multiline
                                maw={300}
                              >
                                <Text
                                  size="xs"
                                  color="red"
                                  style={{ cursor: "help" }}
                                >
                                  hover for details
                                </Text>
                              </Tooltip>
                            )}
                          </td>
                          <td>
                            <Text size="sm">{fmtBytes(b.size_bytes)}</Text>
                          </td>
                          <td>
                            <Text size="sm">
                              {b.status === "in_progress"
                                ? "—"
                                : fmtDuration(b.duration_ms)}
                            </Text>
                          </td>
                          <td>
                            <Group spacing={8}>
                              <Tooltip label="Delete backup" withArrow>
                                <ActionIcon
                                  color="red"
                                  variant="light"
                                  radius="md"
                                  disabled={b.status === "in_progress"}
                                  onClick={() =>
                                    setDeleteModal({ open: true, id: b.id })
                                  }
                                >
                                  <FaTrash size={14} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip
                                label="Restore from this backup"
                                withArrow
                              >
                                <ActionIcon
                                  color="blue"
                                  variant="light"
                                  radius="md"
                                  disabled={b.status !== "success"}
                                  onClick={() =>
                                    setRestoreModal({ open: true, id: b.id })
                                  }
                                >
                                  <FaUpload size={14} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </ScrollArea>
            )}
          </Paper>
        </Box>
      </Flex>

      {/* ── Delete confirm modal ── */}
      <Modal
        opened={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, id: null })}
        title="Delete Backup"
        centered
        radius="md"
      >
        <Text size="sm" mb="xl">
          Are you sure you want to delete this backup? This action cannot be
          undone. The backup file will be permanently removed from disk.
        </Text>
        <Flex justify="space-between">
          <Button
            variant="default"
            onClick={() => setDeleteModal({ open: false, id: null })}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button color="red" onClick={handleDelete} loading={deleting}>
            Delete
          </Button>
        </Flex>
      </Modal>

      {/* ── Restore confirm modal ── */}
      <Modal
        opened={restoreModal.open}
        onClose={() => setRestoreModal({ open: false, id: null })}
        title="Restore Database"
        centered
        radius="md"
      >
        <Text size="sm" mb="md">
          Restoring from this backup will overwrite the current database state.
        </Text>
        <Text size="sm" fw={600} color="red" mb="xl">
          This is a destructive operation and cannot be undone. All data written
          after this backup was created will be lost.
        </Text>
        <Flex justify="space-between">
          <Button
            variant="default"
            onClick={() => setRestoreModal({ open: false, id: null })}
            disabled={restoring}
          >
            Cancel
          </Button>
          <Button color="green" onClick={handleRestore} loading={restoring}>
            Restore
          </Button>
        </Flex>
      </Modal>
    </Box>
  );
};

export default BackupPage;
