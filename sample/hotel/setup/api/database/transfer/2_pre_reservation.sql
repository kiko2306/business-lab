DROP PROCEDURE IF EXISTS _tmp_update_pre_reservations;
DELIMITER $$
-- As unidades tem de estar criadas
CREATE PROCEDURE _tmp_update_pre_reservations()
BEGIN
    DECLARE cursor_List_reservations BOOLEAN DEFAULT FALSE;

    -- Vars
    DECLARE _quiz_id INT;

     DECLARE cursor_List CURSOR FOR
         SELECT
                `quiz_id`
                FROM `guestqui_hotelutils`.`quiz_responses`;


DECLARE CONTINUE HANDLER FOR NOT FOUND SET cursor_List_reservations = TRUE;

OPEN cursor_List;

   loop_List: LOOP
      FETCH cursor_List INTO
            _quiz_id;

        IF cursor_List_reservations THEN
            LEAVE loop_List;
        END IF;

        UPDATE `guestqui_hotelutils`.`quizzes` SET `response` = 1 WHERE `id` = _quiz_id;

END LOOP loop_List;

   CLOSE cursor_List;
END

$$ DELIMITER ;

CALL _tmp_update_pre_reservations();
