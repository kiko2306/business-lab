SELECT ISNULL(SUM(CAST(wsir_vnd_vendas.total AS DECIMAL (18,2))),0) AS Total  
	FROM wsir_vnd_vendas INNER JOIN
         wgctiposdocumentos ON wsir_vnd_vendas.documento = wgctiposdocumentos.codigo
			WHERE wgctiposdocumentos.tipo	= 'F' AND wsir_vnd_vendas.Anulado = 0