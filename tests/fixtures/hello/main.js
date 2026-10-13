// 本地沙箱样例：调用模拟接口、写日志、用 mv.storage 计数。
function search(q) {
  const size = Math.min(Number(mv.config.size || 20), q.limit || 50);
  const res = mv.fetch({
    url: 'https://api.example.com/search?q=' + encodeURIComponent(q.keyword || ''),
    method: 'GET',
  });
  if (res.status !== 200) throw new Error('接口返回 HTTP ' + res.status);
  const data = JSON.parse(res.body);
  const calls = mv.storage.get('calls') || 0;
  mv.storage.set('calls', calls + 1);
  mv.log.info('搜索 ' + q.keyword + '，返回 ' + data.items.length + ' 条');
  return {
    items: data.items.slice(0, size).map((row) => ({
      id: row.id,
      title: row.title,
      link_type: '115',
      share_link: row.link,
      share_code: row.code || '',
    })),
  };
}
