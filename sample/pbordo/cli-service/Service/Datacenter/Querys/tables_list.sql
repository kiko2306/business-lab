SELECT
	wsir_mst_mesas.mesa AS table_number, 
	
	ISNULL(wgcvendedores.nome,'') AS vendor, 
	wsir_mst_mesas.horainicial, 
	wsir_mst_mesas.numclientes,
	ISNULL(SUM(CAST ((wsir_vnd_pedidos.total) AS DECIMAL(18,2))) ,0) as total


FROM wsir_mst_mesas INNER JOIN
		
			wgcvendedores ON wsir_mst_mesas.funcionario = wgcvendedores.codigo LEFT JOIN
				wsir_vnd_pedidos ON wsir_mst_mesas.mesa = wsir_vnd_pedidos.mesa

GROUP BY 
	wsir_mst_mesas.mesa,
	wgcvendedores.nome,
	wsir_mst_mesas.horainicial,
	wsir_mst_mesas.numclientes
	