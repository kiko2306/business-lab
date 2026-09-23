SELECT ISNULL(SUM(CAST(total AS DECIMAL(18,2))),0) AS [Faturação em aberto] 
	FROM wsir_vnd_pedidos