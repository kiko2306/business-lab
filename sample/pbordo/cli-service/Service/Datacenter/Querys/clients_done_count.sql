SELECT ISNULL (SUM(numclientes),0) AS [Clientes atendidos] 
	FROM (SELECT DISTINCT wsir_vnd_vendas.numdoc, wsir_vnd_vendas.documento, wsir_vnd_vendas.numclientes 
		FROM wsir_vnd_vendas INNER JOIN
			wgctiposdocumentos ON wsir_vnd_vendas.documento = wgctiposdocumentos.codigo
				WHERE (wsir_vnd_vendas.Anulado = 0) AND (wsir_vnd_vendas.consumointerno = 0) AND (wgctiposdocumentos.tipo = 'F')) as src