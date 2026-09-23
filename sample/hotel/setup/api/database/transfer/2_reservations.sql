DROP PROCEDURE IF EXISTS _tmp_update_reservations;
DELIMITER $$
-- As unidades tem de estar criadas
CREATE PROCEDURE _tmp_update_reservations()
BEGIN
    DECLARE cursor_List_reservations BOOLEAN DEFAULT FALSE;

    -- Vars
    DECLARE _id INT;
    DECLARE _unit VARCHAR(255);
    DECLARE _guest_code VARCHAR(255);
    DECLARE _reservation INT;
    DECLARE _line INT;
    DECLARE _sent TINYINT(1);
    DECLARE _invalid_mail TINYINT(1);
    DECLARE _no_mail TINYINT(1);
    DECLARE _response TINYINT(1);
    DECLARE _created_at DATETIME;
    DECLARE _updated_at DATETIME;
    -- DECLARE _used_unit VARCHAR(255);

     DECLARE cursor_List CURSOR FOR
         SELECT
                `id`,
                `unit`,
                `gest_code`,
                `reservation`,
                `line`,
                `sent`,
                `invalid_mail`,
                `no_mail`,
                `response`,
                `created_at`,
                `updated_at`
                FROM `guestqui_hotelutils`.`quizzes`;


DECLARE CONTINUE HANDLER FOR NOT FOUND SET cursor_List_reservations = TRUE;

OPEN cursor_List;

   loop_List: LOOP
      FETCH cursor_List INTO
            _id,
            _unit,
            _guest_code,
            _reservation,
            _line,
            _sent,
            _invalid_mail,
            _no_mail,
            _response,
            _created_at,
            _updated_at;

        IF cursor_List_reservations THEN
            LEAVE loop_List;
        END IF;


     SELECT id INTO @selected_unit  FROM `testing`.`hu_units` WHERE code = _unit;
     SELECT id INTO @selected_guest  FROM `testing`.`hu_guests` WHERE code = _guest_code LIMIT 1;


     INSERT INTO `testing`.`hu_reservations`
                                        ( `id`,
                                          `unit_id`,
                                          `number`,
                                          `line`,
                                          `guest_id`,
                                          `room_code`,
                                          `room_name`,
                                          `adults`,
                                          `children`,
                                          `babies`,
                                          `checkin`,
                                          `checkout`,
                                          `checkin_sent`,
                                          `checkin_success`,
                                          `checkin_success_notification`,
                                          `quiz_sent`,
                                          `quiz_response`,
                                          `error_no_email`,
                                          `error_invalid_email`,
                                          `status`,
                                          `channel`,
                                          `uuid`,
                                          `created_at`,
                                          `updated_at`)
                                VALUES (
                                            _id,
                                            @selected_unit,
                                            _reservation,
                                            _line,
                                            @selected_guest,
                                            '',
                                            '',
                                            0,
                                            0,
                                            0,
                                             _created_at,
                                             _created_at,
                                            0,
                                            0,
                                            0,
                                            _sent,
                                            _response,
                                            _no_mail,
                                            _invalid_mail,
                                            'CKO',
                                            'COPY',
                                            UUID(),
                                            _created_at,
                                            _updated_at);

END LOOP loop_List;

   CLOSE cursor_List;
END

$$ DELIMITER ;

CALL _tmp_update_reservations();
