SELECT
	wsir_vnd_meiospagamento.documento, 
	wsir_vnd_meiospagamento.numdoc, 
	wsir_vnd_meiospagamento.total, 
	wgcmeiospagamento.descricao as meioPagamento, 
	wgcvendedores.nome as vendor, 
	wsir_vnd_vendas.Anulado as anulado, 
	wgctiposdocumentos.cco,
	wgctiposdocumentos.devolucao, 
	wsir_vnd_vendas.consumointerno, 
	wgctiposdocumentos.tipo, 
	wsir_vnd_clifactura.nome AS cliente

FROM
	wsir_vnd_meiospagamento INNER JOIN
	wgcmeiospagamento ON wsir_vnd_meiospagamento.meiospagamento = wgcmeiospagamento.codigo INNER JOIN
    wgcvendedores ON wsir_vnd_meiospagamento.funcionario = wgcvendedores.codigo INNER JOIN
    wsir_vnd_vendas ON wsir_vnd_meiospagamento.documento = wsir_vnd_vendas.documento 
		AND wsir_vnd_meiospagamento.numdoc = wsir_vnd_vendas.numdoc INNER JOIN
    wgctiposdocumentos ON wsir_vnd_meiospagamento.documento = wgctiposdocumentos.codigo INNER JOIN
    wsir_vnd_clifactura ON wsir_vnd_meiospagamento.documento = wsir_vnd_clifactura.documento 
		AND wsir_vnd_meiospagamento.numdoc = wsir_vnd_clifactura.numdoc

GROUP BY 
	wsir_vnd_meiospagamento.documento, 
	wsir_vnd_meiospagamento.numdoc, 
	wsir_vnd_meiospagamento.total,
	wgcmeiospagamento.descricao,
	wgcvendedores.nome, 
	wsir_vnd_vendas.Anulado, 
	wgctiposdocumentos.cco, 
    wgctiposdocumentos.devolucao, 
	wsir_vnd_vendas.consumointerno, 
	wgctiposdocumentos.tipo, 
	wsir_vnd_clifactura.nome

