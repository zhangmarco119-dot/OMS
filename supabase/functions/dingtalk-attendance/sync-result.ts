export const summarizeAttendanceSync = (employeeCount: number, successCount: number, failureCount: number) => {
  const status = failureCount === 0 ? 'succeeded' : successCount > 0 ? 'partial' : 'failed';
  const message = employeeCount === 0
    ? '没有可同步的已绑定员工。'
    : status === 'succeeded'
      ? `已同步 ${successCount} 名员工。`
      : `同步完成：${successCount} 名成功，${failureCount} 名失败。`;
  return { status, message } as const;
};
