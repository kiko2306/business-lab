SELECT       ISNULL(SUM(CAST ((wsir_vnd_meiospagamento.total) AS DECIMAL(18,2))) ,0) AS [Conta Corrente] 
FROM            wsir_vnd_meiospagamento INNER JOIN
                         wgctiposdocumentos ON wsir_vnd_meiospagamento.documento = wgctiposdocumentos.codigo
						 WHERE
						 wgctiposdocumentos.tipo = 'F' AND wgctiposdocumentos.cco = 1